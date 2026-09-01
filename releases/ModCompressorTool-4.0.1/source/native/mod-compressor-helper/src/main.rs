use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const VERSION: &str = "0.1.0";
const MIN_COMPRESS_SIZE: u64 = 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    command: String,
    paths: Option<Vec<String>>,
    algorithm: Option<String>,
    threads: Option<usize>,
    /// When true, `paths` has already been filtered by the MO2 plugin.
    /// This keeps native and compact fallback scopes identical.
    explicit: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    ok: bool,
    code: i32,
    message: String,
    version: String,
    mode: String,
    stats: Stats,
    processed: usize,
    changed: usize,
    skipped: usize,
    failed: usize,
    errors: Vec<HelperError>,
    algorithms: Vec<String>,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Stats {
    file_count: u64,
    total_size: u64,
    disk_size: u64,
    skipped_files: u64,
    texture_size: u64,
    mesh_size: u64,
    sound_size: u64,
    lod_size: u64,
    animation_size: u64,
    other_size: u64,
    compressed_by_attr: u64,
    compressed_by_size: u64,
    compressed_by_wof: u64,
    compressed: bool,
    ratio: f64,
    algorithm: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HelperError {
    path: String,
    code: i32,
    message: String,
}

#[derive(Debug, Clone)]
struct FileOp {
    path: PathBuf,
}

#[derive(Debug, Default)]
struct OpResult {
    changed: bool,
    skipped: bool,
    error: Option<HelperError>,
}

fn main() {
    let response = match run() {
        Ok(response) => response,
        Err(err) => Response {
            ok: false,
            code: 1,
            message: err,
            version: VERSION.to_string(),
            mode: "native".to_string(),
            stats: Stats::default(),
            processed: 0,
            changed: 0,
            skipped: 0,
            failed: 1,
            errors: Vec::new(),
            algorithms: supported_algorithms(),
        },
    };

    println!(
        "{}",
        serde_json::to_string(&response).unwrap_or_else(|_| "{\"ok\":false}".to_string())
    );
}

fn run() -> Result<Response, String> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|err| format!("failed to read stdin: {err}"))?;
    let request: Request =
        serde_json::from_str(&input).map_err(|err| format!("invalid request JSON: {err}"))?;

    match request.command.as_str() {
        "probe" => Ok(base_response(true, 0, "native helper ready")),
        "measure" => {
            let files = collect_files(
                request.paths.as_deref().unwrap_or(&[]),
                CollectMode::Measure,
                request.explicit.unwrap_or(false),
            );
            let stats = measure_files(&files);
            let mut response = base_response(true, 0, "measured");
            response.processed = files.len();
            response.stats = stats;
            Ok(response)
        }
        "compress" => {
            let algorithm = Algorithm::parse(
                request
                    .algorithm
                    .as_deref()
                    .ok_or_else(|| "compress requires algorithm".to_string())?,
            )?;
            let files = collect_files(
                request.paths.as_deref().unwrap_or(&[]),
                CollectMode::Compress,
                request.explicit.unwrap_or(false),
            );
            let results = run_parallel(files.clone(), request.threads, |file| {
                compress_file(&file.path, algorithm)
            });
            Ok(response_from_results("compressed", files, results))
        }
        "decompress" => {
            let files = collect_files(
                request.paths.as_deref().unwrap_or(&[]),
                CollectMode::Decompress,
                request.explicit.unwrap_or(false),
            );
            let results = run_parallel(files.clone(), request.threads, |file| {
                decompress_file(&file.path)
            });
            Ok(response_from_results("decompressed", files, results))
        }
        other => Err(format!("unknown command: {other}")),
    }
}

fn base_response(ok: bool, code: i32, message: &str) -> Response {
    Response {
        ok,
        code,
        message: message.to_string(),
        version: VERSION.to_string(),
        mode: "native".to_string(),
        stats: Stats::default(),
        processed: 0,
        changed: 0,
        skipped: 0,
        failed: 0,
        errors: Vec::new(),
        algorithms: supported_algorithms(),
    }
}

fn supported_algorithms() -> Vec<String> {
    ["xpress4k", "xpress8k", "xpress16k", "lzx"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

fn response_from_results(message: &str, files: Vec<FileOp>, results: Vec<OpResult>) -> Response {
    let changed = results.iter().filter(|r| r.changed).count();
    let skipped = results.iter().filter(|r| r.skipped).count();
    let failed = results.iter().filter(|r| r.error.is_some()).count();
    let errors: Vec<HelperError> = results
        .iter()
        .filter_map(|result| result.error.clone())
        .take(20)
        .collect();

    Response {
        ok: failed == 0,
        code: if failed == 0 { 0 } else { 1 },
        message: message.to_string(),
        version: VERSION.to_string(),
        mode: "native".to_string(),
        stats: Stats::default(),
        processed: files.len(),
        changed,
        skipped,
        failed,
        errors,
        algorithms: supported_algorithms(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CollectMode {
    Compress,
    Decompress,
    Measure,
}

fn collect_files(paths: &[String], mode: CollectMode, explicit: bool) -> Vec<FileOp> {
    let mut files = Vec::new();
    for raw in paths {
        let root = PathBuf::from(raw);
        if is_regular_file(&root) {
            if mode != CollectMode::Compress || explicit || should_compress(&root) {
                files.push(FileOp { path: root });
            }
            continue;
        }

        if !root.is_dir() {
            continue;
        }

        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path().to_path_buf();
            if mode == CollectMode::Compress && !explicit && !should_compress(&path) {
                continue;
            }
            files.push(FileOp { path });
        }
    }
    files
}

fn is_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_file())
        .unwrap_or(false)
}

fn should_compress(path: &Path) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    if meta.len() < MIN_COMPRESS_SIZE {
        return false;
    }
    let ext = path
        .extension()
        .and_then(OsStr::to_str)
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "dds"
            | "tga"
            | "bmp"
            | "nif"
            | "btr"
            | "bto"
            | "tri"
            | "wav"
            | "xwm"
            | "hkx"
            | "kf"
            | "lst"
            | "btd"
            | "lod"
    )
}

fn run_parallel<F>(files: Vec<FileOp>, threads: Option<usize>, op: F) -> Vec<OpResult>
where
    F: Fn(&FileOp) -> OpResult + Sync + Send,
{
    let default_threads = num_cpus::get().saturating_sub(2).clamp(2, 8);
    let thread_count = threads
        .filter(|count| *count > 0)
        .unwrap_or(default_threads)
        .clamp(1, 16);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(thread_count)
        .build()
        .expect("rayon pool");
    pool.install(|| files.par_iter().map(op).collect())
}

fn measure_files(files: &[FileOp]) -> Stats {
    let mut stats = Stats::default();
    let mut algorithm_counts: HashMap<String, u64> = HashMap::new();

    for file in files {
        let Ok(meta) = fs::metadata(&file.path) else {
            stats.skipped_files += 1;
            continue;
        };
        let logical = meta.len();
        let physical = compressed_file_size(&file.path).unwrap_or(logical);
        stats.file_count += 1;
        stats.total_size = stats.total_size.saturating_add(logical);
        stats.disk_size = stats.disk_size.saturating_add(physical);
        if physical < logical {
            stats.compressed_by_size += 1;
        }
        match classify(&file.path) {
            "texture" => stats.texture_size += logical,
            "mesh" => stats.mesh_size += logical,
            "sound" => stats.sound_size += logical,
            "lod" => stats.lod_size += logical,
            "animation" => stats.animation_size += logical,
            _ => stats.other_size += logical,
        }
        if has_ntfs_compressed_attr(&file.path) {
            stats.compressed_by_attr += 1;
        }
        if let Some(algorithm) = wof_algorithm(&file.path) {
            stats.compressed_by_wof += 1;
            *algorithm_counts.entry(algorithm).or_insert(0) += 1;
        }
    }

    stats.compressed =
        stats.compressed_by_wof > 0 || stats.compressed_by_attr > 0 || stats.compressed_by_size > 0;
    stats.ratio = if stats.total_size > 0 && stats.disk_size > 0 {
        stats.total_size as f64 / stats.disk_size as f64
    } else {
        1.0
    };
    stats.algorithm = algorithm_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(algorithm, _)| algorithm)
        .unwrap_or_default();
    stats
}

fn classify(path: &Path) -> &'static str {
    let lower = path.to_string_lossy().to_ascii_lowercase();
    let name = path
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    if lower.contains("\\lod\\")
        || lower.contains("/lod/")
        || lower.contains("\\dyndolod\\")
        || lower.contains("/dyndolod/")
        || lower.contains("\\terrain\\")
        || lower.contains("/terrain/")
        || lower.contains("\\grass\\")
        || lower.contains("/grass/")
        || lower.contains("\\xlodgen\\")
        || lower.contains("/xlodgen/")
        || lower.contains("\\texgen\\")
        || lower.contains("/texgen/")
        || lower.contains("\\billboards\\")
        || lower.contains("/billboards/")
        || lower.contains("\\occlusion\\")
        || lower.contains("/occlusion/")
        || lower.contains("\\lodsettings\\")
        || lower.contains("/lodsettings/")
        || name.ends_with(".lod")
        || name.contains("_lod")
        || name.contains("_far.")
    {
        return "lod";
    }

    match path
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "dds" | "tga" | "bmp" => "texture",
        "nif" | "btr" | "bto" | "tri" => "mesh",
        "wav" | "xwm" | "lip" | "fuz" => "sound",
        "lst" | "btd" | "lod" => "lod",
        "hkx" | "kf" => "animation",
        _ => "other",
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Algorithm {
    Xpress4k,
    Xpress8k,
    Xpress16k,
    Lzx,
}

impl Algorithm {
    fn parse(raw: &str) -> Result<Self, String> {
        match raw.to_ascii_lowercase().as_str() {
            "xpress4k" => Ok(Self::Xpress4k),
            "xpress8k" => Ok(Self::Xpress8k),
            "xpress16k" => Ok(Self::Xpress16k),
            "lzx" => Ok(Self::Lzx),
            _ => Err(format!("unsupported algorithm: {raw}")),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Xpress4k => "xpress4k",
            Self::Xpress8k => "xpress8k",
            Self::Xpress16k => "xpress16k",
            Self::Lzx => "lzx",
        }
    }

    #[cfg(windows)]
    fn wof_code(self) -> u32 {
        match self {
            Self::Xpress4k => 0,
            Self::Lzx => 1,
            Self::Xpress8k => 2,
            Self::Xpress16k => 3,
        }
    }
}

#[cfg(not(windows))]
fn compress_file(path: &Path, _algorithm: Algorithm) -> OpResult {
    OpResult {
        error: Some(HelperError {
            path: path.display().to_string(),
            code: 1,
            message: "native helper only supports Windows".to_string(),
        }),
        ..Default::default()
    }
}

#[cfg(not(windows))]
fn decompress_file(path: &Path) -> OpResult {
    OpResult {
        error: Some(HelperError {
            path: path.display().to_string(),
            code: 1,
            message: "native helper only supports Windows".to_string(),
        }),
        ..Default::default()
    }
}

#[cfg(not(windows))]
fn compressed_file_size(_path: &Path) -> Option<u64> {
    None
}

#[cfg(not(windows))]
fn has_ntfs_compressed_attr(_path: &Path) -> bool {
    false
}

#[cfg(not(windows))]
fn wof_algorithm(_path: &Path) -> Option<String> {
    None
}

#[cfg(windows)]
mod win {
    use super::{Algorithm, HelperError, OpResult};
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, BOOL, HANDLE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, GetCompressedFileSizeW, GetFileAttributesW, FILE_ATTRIBUTE_COMPRESSED,
        FILE_ATTRIBUTE_NORMAL, FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::IO::DeviceIoControl;

    const GENERIC_READ: u32 = 0x8000_0000;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    const WOF_PROVIDER_FILE: u32 = 0x0000_0002;
    const ERROR_COMPRESSION_NOT_BENEFICIAL: u32 = 344;
    const COMPRESSION_FORMAT_NONE: u16 = 0;

    const FILE_DEVICE_FILE_SYSTEM: u32 = 0x0000_0009;
    const METHOD_BUFFERED: u32 = 0;
    const FILE_ANY_ACCESS: u32 = 0;
    const FILE_READ_DATA: u32 = 0x0001;
    const FILE_WRITE_DATA: u32 = 0x0002;
    const FSCTL_DELETE_EXTERNAL_BACKING: u32 = ctl_code(
        FILE_DEVICE_FILE_SYSTEM,
        197,
        METHOD_BUFFERED,
        FILE_ANY_ACCESS,
    );
    const FSCTL_SET_COMPRESSION: u32 = ctl_code(
        FILE_DEVICE_FILE_SYSTEM,
        16,
        METHOD_BUFFERED,
        FILE_READ_DATA | FILE_WRITE_DATA,
    );

    const fn ctl_code(device_type: u32, function: u32, method: u32, access: u32) -> u32 {
        (device_type << 16) | (access << 14) | (function << 2) | method
    }

    #[repr(C)]
    struct WofFileCompressionInfo {
        algorithm: u32,
        flags: u32,
    }

    #[link(name = "Wofutil")]
    extern "system" {
        fn WofSetFileDataLocation(
            file_handle: HANDLE,
            provider: u32,
            external_file_info: *mut c_void,
            length: u32,
        ) -> i32;
        fn WofIsExternalFile(
            file_path: *const u16,
            is_external_file: *mut BOOL,
            provider: *mut u32,
            external_file_info: *mut c_void,
            buffer_length: *mut u32,
        ) -> i32;
    }

    pub fn compress_file(path: &Path, algorithm: Algorithm) -> OpResult {
        let logical = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
        let physical = compressed_file_size(path).unwrap_or(logical);
        if physical < logical {
            if let Some(existing) = wof_algorithm(path) {
                if existing == algorithm.name() {
                    return OpResult {
                        skipped: true,
                        ..Default::default()
                    };
                }
                let _ = decompress_file(path);
            }
        }

        let Ok(handle) = open_file(path) else {
            return error(path, last_error() as i32, "open for compression failed");
        };
        let mut info = WofFileCompressionInfo {
            algorithm: algorithm.wof_code(),
            flags: 0,
        };
        let hr = unsafe {
            WofSetFileDataLocation(
                handle,
                WOF_PROVIDER_FILE,
                &mut info as *mut _ as *mut c_void,
                std::mem::size_of::<WofFileCompressionInfo>() as u32,
            )
        };
        unsafe {
            CloseHandle(handle);
        }

        if hr >= 0 {
            return OpResult {
                changed: true,
                ..Default::default()
            };
        }

        let code = hresult_code(hr);
        if code == ERROR_COMPRESSION_NOT_BENEFICIAL {
            return OpResult {
                skipped: true,
                ..Default::default()
            };
        }
        error(path, code as i32, "WofSetFileDataLocation failed")
    }

    pub fn decompress_file(path: &Path) -> OpResult {
        let mut changed = false;
        if wof_algorithm(path).is_some() {
            let Ok(handle) = open_file(path) else {
                return error(
                    path,
                    last_error() as i32,
                    "open for WOF decompression failed",
                );
            };
            let mut bytes = 0u32;
            let ok = unsafe {
                DeviceIoControl(
                    handle,
                    FSCTL_DELETE_EXTERNAL_BACKING,
                    std::ptr::null_mut(),
                    0,
                    std::ptr::null_mut(),
                    0,
                    &mut bytes,
                    std::ptr::null_mut(),
                )
            };
            unsafe {
                CloseHandle(handle);
            }
            if ok == 0 {
                if wof_algorithm(path).is_none() {
                    return OpResult {
                        changed: true,
                        ..Default::default()
                    };
                }
                return error(
                    path,
                    last_error() as i32,
                    "FSCTL_DELETE_EXTERNAL_BACKING failed",
                );
            }
            changed = true;
        }

        if has_ntfs_compressed_attr(path) {
            let Ok(handle) = open_file(path) else {
                return error(
                    path,
                    last_error() as i32,
                    "open for NTFS decompression failed",
                );
            };
            let mut format = COMPRESSION_FORMAT_NONE;
            let mut bytes = 0u32;
            let ok = unsafe {
                DeviceIoControl(
                    handle,
                    FSCTL_SET_COMPRESSION,
                    &mut format as *mut _ as *mut c_void,
                    std::mem::size_of::<u16>() as u32,
                    std::ptr::null_mut(),
                    0,
                    &mut bytes,
                    std::ptr::null_mut(),
                )
            };
            unsafe {
                CloseHandle(handle);
            }
            if ok == 0 {
                return error(path, last_error() as i32, "FSCTL_SET_COMPRESSION failed");
            }
            changed = true;
        }

        if changed {
            OpResult {
                changed: true,
                ..Default::default()
            }
        } else {
            OpResult {
                skipped: true,
                ..Default::default()
            }
        }
    }

    pub fn compressed_file_size(path: &Path) -> Option<u64> {
        let wide = wide(path);
        let mut high = 0u32;
        let low = unsafe { GetCompressedFileSizeW(wide.as_ptr(), &mut high) };
        if low == u32::MAX {
            let err = unsafe { GetLastError() };
            if err != 0 {
                return None;
            }
        }
        Some(((high as u64) << 32) | low as u64)
    }

    pub fn has_ntfs_compressed_attr(path: &Path) -> bool {
        let wide = wide(path);
        let attrs = unsafe { GetFileAttributesW(wide.as_ptr()) };
        attrs != u32::MAX && (attrs & FILE_ATTRIBUTE_COMPRESSED) != 0
    }

    pub fn wof_algorithm(path: &Path) -> Option<String> {
        let wide = wide(path);
        let mut is_external = 0i32;
        let mut provider = 0u32;
        let mut info = WofFileCompressionInfo {
            algorithm: 0,
            flags: 0,
        };
        let mut len = std::mem::size_of::<WofFileCompressionInfo>() as u32;
        let hr = unsafe {
            WofIsExternalFile(
                wide.as_ptr(),
                &mut is_external,
                &mut provider,
                &mut info as *mut _ as *mut c_void,
                &mut len,
            )
        };
        if hr < 0 || is_external == 0 || provider != WOF_PROVIDER_FILE {
            return None;
        }
        match info.algorithm {
            0 => Some("xpress4k".to_string()),
            1 => Some("lzx".to_string()),
            2 => Some("xpress8k".to_string()),
            3 => Some("xpress16k".to_string()),
            _ => Some(format!("wof-{}", info.algorithm)),
        }
    }

    fn open_file(path: &Path) -> Result<HANDLE, ()> {
        let wide = wide(path);
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                std::ptr::null(),
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL | FILE_FLAG_BACKUP_SEMANTICS,
                std::ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            Err(())
        } else {
            Ok(handle)
        }
    }

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    fn last_error() -> u32 {
        unsafe { GetLastError() }
    }

    fn hresult_code(hr: i32) -> u32 {
        (hr as u32) & 0xffff
    }

    fn error(path: &Path, code: i32, message: &str) -> OpResult {
        OpResult {
            error: Some(HelperError {
                path: path.display().to_string(),
                code,
                message: message.to_string(),
            }),
            ..Default::default()
        }
    }
}

#[cfg(windows)]
use win::{
    compress_file, compressed_file_size, decompress_file, has_ntfs_compressed_attr, wof_algorithm,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_all_supported_algorithms() {
        assert_eq!(Algorithm::parse("xpress4k").unwrap().name(), "xpress4k");
        assert_eq!(Algorithm::parse("xpress8k").unwrap().name(), "xpress8k");
        assert_eq!(Algorithm::parse("xpress16k").unwrap().name(), "xpress16k");
        assert_eq!(Algorithm::parse("lzx").unwrap().name(), "lzx");
        assert!(Algorithm::parse("zip").is_err());
    }

    #[test]
    fn classifies_common_mod_file_types() {
        assert_eq!(classify(Path::new("C:/mod/textures/wall.dds")), "texture");
        assert_eq!(classify(Path::new("C:/mod/meshes/armor.nif")), "mesh");
        assert_eq!(classify(Path::new("C:/mod/sound/fx.wav")), "sound");
        assert_eq!(
            classify(Path::new("C:/mod/animations/idle.hkx")),
            "animation"
        );
        assert_eq!(
            classify(Path::new("C:/mod/textures/terrain/tamriel.dds")),
            "lod"
        );
    }

    #[test]
    fn compressible_extension_rules_match_mod_assets() {
        let root =
            std::env::temp_dir().join(format!("mod-compressor-helper-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        for name in [
            "texture.dds",
            "mesh.nif",
            "anim.hkx",
            "plugin.esp",
            "archive.ba2",
            "readme.txt",
        ] {
            fs::write(root.join(name), vec![0u8; MIN_COMPRESS_SIZE as usize + 1]).unwrap();
        }

        assert!(should_compress(&root.join("texture.dds")));
        assert!(should_compress(&root.join("mesh.nif")));
        assert!(should_compress(&root.join("anim.hkx")));
        assert!(!should_compress(&root.join("plugin.esp")));
        assert!(!should_compress(&root.join("archive.ba2")));
        assert!(!should_compress(&root.join("readme.txt")));
        fs::remove_dir_all(root).unwrap();
    }
}
