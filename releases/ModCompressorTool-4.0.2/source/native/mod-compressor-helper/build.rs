use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=mod-compressor-helper.rc");

    if cfg!(all(windows, target_env = "msvc")) {
        let out_dir = PathBuf::from(
            env::var_os("OUT_DIR").expect("Cargo did not provide OUT_DIR"),
        );
        let resource = out_dir.join("mod-compressor-helper.res");
        let source = PathBuf::from("mod-compressor-helper.rc");
        let rc = env::var_os("RC").unwrap_or_else(|| "rc.exe".into());

        let status = Command::new(&rc)
            .arg("/nologo")
            .arg(format!("/fo{}", resource.display()))
            .arg(&source)
            .status()
            .unwrap_or_else(|error| {
                panic!(
                    "failed to run Windows resource compiler '{}': {error}",
                    PathBuf::from(&rc).display()
                )
            });
        assert!(
            status.success(),
            "Windows resource compiler '{}' failed with {status}",
            PathBuf::from(&rc).display()
        );

        println!(
            "cargo:rustc-link-arg-bin=mod-compressor-helper={}",
            resource.display()
        );
        println!("cargo:rustc-link-arg-bin=mod-compressor-helper=/DEBUG:NONE");
    }
}
