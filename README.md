# Mod Compressor Tool

Mod Organizer 2 plugin for Windows file compression of Bethesda mod files.
The plugin keeps the file data unchanged and uses the native helper when it is
available, with `compact.exe` as a fallback.

## Current release

Version **4.0.3** is in [`releases/ModCompressorTool-4.0.3`](releases/ModCompressorTool-4.0.3).
The ready-to-install archive is [`releases/ModCompressorTool-4.0.3.zip`](releases/ModCompressorTool-4.0.3.zip)
and its SHA-256 checksum is next to it.

Install the archive with MO2 closed. Copy its contents into the MO2 folder so
the plugin and helper are installed at:

```text
MO2\plugins\mod_compressor_tool.py
MO2\plugins\native\mod-compressor-helper.exe
```

## Documentation

- [`NEXUSMODS_CHANGELOG.md`](NEXUSMODS_CHANGELOG.md) — plain-language user changelog.
- [`VORTEX_VS_MO2_DIFFERENTIAL_ANALYSIS.md`](VORTEX_VS_MO2_DIFFERENTIAL_ANALYSIS.md) — detailed comparison and port plan.
- [`releases/ModCompressorTool-4.0.3/README.md`](releases/ModCompressorTool-4.0.3/README.md) — release notes, hashes, and install details.

The native helper source and build instructions are under [`native`](native).
The project is licensed under GPL-3.0; the release package includes the full
license text.

## Verification

Run the Python tests with:

```powershell
$env:QT_QPA_PLATFORM = "offscreen"
py -3 -m unittest discover -s tests -v
```

Use `scripts\validate-package.ps1` to validate the MO2 package layout and
archive paths.
