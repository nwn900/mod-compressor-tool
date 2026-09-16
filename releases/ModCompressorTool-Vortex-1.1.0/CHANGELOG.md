# Changelog

## 1.1.0 — 2026-09-16

This is the standalone Vortex archive for the audited 1.1.0 extension. The
runtime files are at the archive root, as required by Vortex, and the native
helper is included at `native/mod-compressor-helper.exe`.

### Fixed

- **Select all** keeps the full selection without rendering every mod row at
  once, preventing large Vortex lists from freezing.
- Scan, compress, and decompress operations report file-level progress for the
  current mod instead of filling the bar immediately.
- Scoped target selection no longer treats an arbitrary mod name as LOD data.
- A successful command is not treated as proof that files changed; the result
  is measured or queried when needed.
- The native helper is probed and its response schema is checked before use;
  incompatible helpers fall back to `compact.exe`.
- The compression service follows Vortex game changes instead of remaining
  attached to the game that was active at startup.
- Debug logging is asynchronous and capped with one rotated file to avoid UI
  stalls and unbounded growth.

### Packaging

- `info.json` and the bundled `index.js` are at the archive root.
- The helper, documentation, changelog, and GPL-3.0 license are included.
- MO2 files, source trees, build outputs, and duplicate helper copies are not
  included in this Vortex runtime archive.
