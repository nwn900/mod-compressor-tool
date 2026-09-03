# Native WOF helper

`mod-compressor-helper` is the optional Windows backend used by
`mod_compressor_tool.py`. It applies WOF/NTFS compression through the Windows
API, measures logical/physical sizes, reports WOF algorithms, and uses bounded
Rayon parallelism. The Python plugin remains functional without the helper by
falling back to `compact.exe` with the same explicit file list.

The Rust implementation is a reviewed MO2-side port of the installed Vortex
helper (`mod-compressor-helper`, GPL-3.0); the Python path-selection and
provenance rules remain authoritative for this plugin.

Build the release executable on Windows with Rust/Cargo. The release profile
strips symbols and the Windows SDK resource compiler embeds VERSIONINFO
metadata (company, product, description, and original filename) in the PE.
`native\build-helper.ps1` discovers `rc.exe` in the installed Windows SDK; set
`RC` explicitly when using a non-standard SDK location:

```powershell
.\native\build-helper.ps1
```

For a direct Cargo invocation, set `RC` first when `rc.exe` is not already on
`PATH`, then copy the resulting executable from `target\release` as shown
below:

```powershell
$env:RC = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.18362.0\x64\rc.exe"
cargo build --release --manifest-path .\native\mod-compressor-helper\Cargo.toml
Copy-Item .\native\mod-compressor-helper\target\release\mod-compressor-helper.exe `
  .\native\mod-compressor-helper.exe
```

The build script accepts `RC` as an override and links the generated resource
without a third-party resource-embedding crate. This keeps the build
dependency set limited to the locked runtime crates. The binary remains
unsigned unless a trusted release certificate is supplied separately; metadata
does not replace Authenticode signing.

Before packaging, run `.\scripts\validate-package.ps1` from the workspace;
it fails closed when the executable is missing and can also inspect a ZIP for
absolute or traversal entries with `-ArchivePath`.

The executable communicates over one JSON request on stdin and one JSON
response on stdout. Protocol version `0.1.0` supports `probe`, `measure`,
`compress`, and `decompress`; operation requests set `explicit: true` because
the MO2 plugin has already applied its extension, size, symlink, and provenance
filters. Do not ship a helper built from an unreviewed source or copy the
installed Vortex binary into this workspace.
