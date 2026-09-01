# Mod Compressor Tool 4.0.3

MO2 Python plugin for transparent Windows WOF/NTFS compression of Bethesda
mod files. The release keeps the native helper optional: if it cannot be
started or fails its protocol probe, the plugin uses `compact.exe` with the
same validated file list.

## Changes in 4.0.3

- Scan progress is measured per visible file, with a final compression-query
  checkpoint when needed. A single-mod scan no longer fills the bar at start.
- Compression and decompression now report explicit-path batch checkpoints for
  both the native helper and `compact.exe` fallback. The worker reserves a
  final post-operation measurement checkpoint, and the bar labels show
  `done/total` plus the current file or batch.
- The native helper executable is unchanged from 4.0.2
  (`B91C4F43F8DEF7B22E8ABA1E34B84BD6B9C94293B39BF9DA570039F3E4F4F901`); this
  release changes the Python/UI progress path only. It does not pack,
  obfuscate, or mutate the helper to chase antivirus scores.

## Changes inherited from 4.0.2

- The native helper now carries standard Windows VERSIONINFO metadata for
  product identity, description, company, version, and original filename.
- Release builds pass `/DEBUG:NONE` to the linker and do not ship a PDB or
  CodeView debug record. This improves release provenance without packing,
  obfuscating, or changing helper behavior.
- The build uses the Windows SDK `rc.exe` directly and keeps the Rust
  dependency graph locked to the runtime crates. The helper is still unsigned
  unless a trusted Authenticode certificate is supplied.

- Bulk selection and clear-all no longer perform a selected-count scan for
  every checkbox. Qt signals and repaints are batched, so large MO2 mod lists
  remain responsive instead of appearing to freeze.
- The compressed, uncompressed, and LOD selection actions use the same safe
  bulk-update path; LOD matching also uses an indexed lookup.

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
  the Rust WOF helper, protocol `0.1.0`, with embedded VERSIONINFO metadata.
- `source/` — helper source, Cargo manifest, lockfile, and build metadata.
- `docs/` — Vortex/MO2 differential analysis and port notes.
- `NEXUSMODS_CHANGELOG.md` — publication-ready summary of changes from the
  original MO2 4.0 plugin.
- `LICENSE-GPL-3.0.txt` — GPL-3.0 license text for the native helper.

The helper is Windows-only and requires a Windows volume that supports WOF.
The plugin remains usable through the compact.exe fallback when the helper or
WOF capability is unavailable.

## Release hashes

```text
mod_compressor_tool.py
  SHA-256 B5AFC3A63AFB16FD0816742BAF70A8F51029BDA4277567EDF799460A80DED081
mod-compressor-helper.exe
  SHA-256 B91C4F43F8DEF7B22E8ABA1E34B84BD6B9C94293B39BF9DA570039F3E4F4F901
```

The package was validated for the required MO2 layout and unsafe archive
paths. Runtime filesystem A/B tests and a live MO2/game smoke test are still
recommended before broad deployment.
