# Native WOF helper

`mod-compressor-helper` is the optional Windows backend used by
`mod_compressor_tool.py`. It applies WOF/NTFS compression through the Windows
API, measures logical/physical sizes, reports WOF algorithms, and uses bounded
Rayon parallelism. The Python plugin remains functional without the helper by
falling back to `compact.exe` with the same explicit file list.

The Rust implementation is a reviewed MO2-side port of the installed Vortex
helper (`mod-compressor-helper`, GPL-3.0); the Python path-selection and
provenance rules remain authoritative for this plugin.

Build the release executable on Windows with Rust/Cargo:

```powershell
cargo build --release --manifest-path .\native\mod-compressor-helper\Cargo.toml
Copy-Item .\native\mod-compressor-helper\target\release\mod-compressor-helper.exe `
  .\native\mod-compressor-helper.exe
```

Before packaging, run `.\scripts\validate-package.ps1` from the workspace;
it fails closed when the executable is missing and can also inspect a ZIP for
absolute or traversal entries with `-ArchivePath`.

The executable communicates over one JSON request on stdin and one JSON
response on stdout. Protocol version `0.1.0` supports `probe`, `measure`,
`compress`, and `decompress`; operation requests set `explicit: true` because
the MO2 plugin has already applied its extension, size, symlink, and provenance
filters. Do not ship a helper built from an unreviewed source or copy the
installed Vortex binary into this workspace.
