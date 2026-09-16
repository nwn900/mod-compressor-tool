# Mod Compressor — Vortex Extension 1.0.0

Mod Compressor saves disk space by applying Windows NTFS transparent
compression to Bethesda game mod files. The game continues to read the files
normally. This package is the standalone Vortex extension release.

## Requirements

- Windows with an NTFS volume and `compact.exe`.
- Vortex 1.0.0 or newer.
- An active Bethesda game profile (for example Skyrim SE, Fallout 4, or
  Starfield).

The extension does not support unmanaged or foreign mods. Compression support
also depends on the file system used by the mod staging directory.

## Installation

1. Download `ModCompressorTool-Vortex-1.0.0.zip`.
2. In Vortex, open **Extensions** and use **Drop file** to install the
   archive.
3. Enable **Mod Compressor** when Vortex asks.
4. Open the **Mod Compressor** page from the Vortex sidebar while a supported
   Bethesda game is active.

For manual testing, extract the archive so that `index.js` and `info.json` are
directly inside `%APPDATA%\Vortex\plugins\mod-compressor`, then restart Vortex.
Do not put the files inside an additional `vortex` or version-named folder.

The archive also includes `gameart.png` at its root. This is the artwork Vortex
uses for the extension and must stay beside `index.js` and `info.json`.

## Usage

1. Choose targets such as textures, meshes, sounds, LOD/DynDOLOD, animations,
   or the entire mod.
2. Choose an NTFS algorithm: `XPRESS4K`, `XPRESS8K` (default), `XPRESS16K`, or
   `LZX`.
3. Use **Scan selected**, then select mods and choose **Compress** or
   **Decompress**.
4. The progress bar reports completed files for the current mod. The log panel
   records the command result and any fallback or verification details.

The selection controls include filters for active, compressed, uncompressed,
LOD, and search results. Large lists are paged, so **Select all** does not try
to render every row in one frame.

## Safety and compatibility

- The bundled helper performs local file operations and reports per-file
  progress. It is used only after a protocol check succeeds.
- If the helper cannot start or the volume does not support the requested
  operation, the extension falls back to Windows `compact.exe`.
- The extension verifies compression state when command output does not include
  a usable size summary.
- No network connection is required for compression operations.
- The native helper is an unsigned Windows executable. Its purpose and source
  are public so antivirus or Nexus review can be investigated with the exact
  file hash.

## Source and license

Source, tests, and build instructions are available in the
[Mod Compressor Tool repository](https://github.com/nwn900/mod-compressor-tool).
The extension and helper are GPL-3.0; see `LICENSE-GPL-3.0.txt`.

See `CHANGELOG.md` for the user-visible changes in version 1.0.0.
