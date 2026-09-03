# Changelog

## 1.1.0 - 2026-09-03

### Fixed

- Selecting all mods no longer tries to render the full mod list in one frame.
  The list is paged, while selection still includes every filtered mod.
- Scan, compress, and decompress operations now report file-level progress for
  the current mod instead of showing an immediate full bar.
- Scoped target selection no longer treats an arbitrary mod name as LOD data.
- A successful command is no longer treated as proof that files changed. The
  extension measures or queries the resulting state when needed.
- The native helper is probed and its response schema is checked before use;
  incompatible helpers fall back to `compact.exe`.
- The compression service follows Vortex game changes instead of remaining
  attached to the game that was active at startup.
- Debug logging is asynchronous and capped with one rotated file, avoiding
  synchronous UI stalls and unbounded growth.

### Packaging

- Release archives include `info.json`, the bundled native helper, README,
  changelog, and GPL license alongside the JavaScript bundle.
- CI runs the TypeScript tests, type checking, native helper tests, and a
  production dependency audit before a release is created.
