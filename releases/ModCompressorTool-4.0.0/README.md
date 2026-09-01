# Mod Compressor Tool 4.0.0

MO2 Python plugin for transparent Windows WOF/NTFS compression of Bethesda
mod files. The release keeps the native helper optional: if it cannot be
started or fails its protocol probe, the plugin uses `compact.exe` with the
same validated file list.

## Install

Close Mod Organizer 2, then copy the archive contents into the MO2
installation directory so these paths land beside the existing MO2 files:

```text
plugins/mod_compressor_tool.py
plugins/native/mod-compressor-helper.exe
```

Restart MO2 and open **Tools → Mod Compressor**. Do not copy the helper into a
mod's `Data` directory; it is an MO2 plugin helper and must remain under
`MO2\plugins\native`.

## Included files

- `plugins/mod_compressor_tool.py` — MO2 plugin.
- `plugins/native/mod-compressor-helper.exe` — locally built release binary of
  the Rust WOF helper, protocol `0.1.0`.
- `source/` — helper source, Cargo manifest, lockfile, and build metadata.
- `docs/` — Vortex/MO2 differential analysis and port notes.
- `LICENSE-GPL-3.0.txt` — GPL-3.0 license text for the native helper.

The helper is Windows-only and requires a Windows volume that supports WOF.
The plugin remains usable through the compact.exe fallback when the helper or
WOF capability is unavailable.

## Release hashes

```text
mod_compressor_tool.py
  SHA-256 778B29BD11508C1C38FB094849A80DD0BA77A55A68DE688E186FA330E2A05B56
mod-compressor-helper.exe
  SHA-256 A2391AF9B52F5F8BC68ABBD6D6FF89673FBE7D736F8111D9547FFC322A1A45E6
```

The package was validated for the required MO2 layout and unsafe archive
paths. Runtime filesystem A/B tests and a live MO2/game smoke test are still
recommended before broad deployment.
