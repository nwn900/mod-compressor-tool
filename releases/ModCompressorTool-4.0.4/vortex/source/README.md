# Mod Compressor — Vortex Extension

Compress Bethesda game mod folders using Windows **NTFS transparent compression** (`compact.exe`). Port of the [MO2 mod_compressor_tool](https://www.nexusmods.com/skyrimspecialedition/mods/9585) plugin.

Saves disk space by compressing mod files that benefit most (textures, meshes, sounds) while keeping the mods fully functional — the game reads them transparently.

## Requirements

- **Windows** (NTFS with `compact.exe`)
- **Vortex** ≥ 1.0.0
- A **Bethesda game** profile active (Skyrim SE, Fallout 4, Starfield, etc.)

Unmanaged/foreign mods are not supported.

## Installation

1. **Download** the latest archive from the [GitHub Releases](https://github.com/nwn900/mod-compressor-vortex-extension/releases) page.
2. **Drag & drop** the archive into the Vortex mods list, or install manually via **Extensions → Drop file**.
3. **Enable** the extension.
4. A **Mod Compressor** entry appears in the sidebar when a supported game is active.

## Usage

1. Select your **targets** (Textures, Meshes, Sounds, LOD/DynDOLOD, Animations, or Entire mod).
2. Choose a **compression algorithm**:
   - `XPRESS4K` — fastest, lowest ratio
   - `XPRESS8K` — good balance (default)
   - `XPRESS16K` — better ratio
   - `LZX` — best ratio, slower
3. Click **Scan selected** to check current compression status.
4. Select mods and click **Compress** or **Decompress**.
5. The progress bar shows files completed for the current mod. The log panel shows results.

### Filters & Selection

- `Active only` — show only enabled mods
- `Compressed / Uncompressed` — filter by state
- `Has LOD` — mods with LOD/DynDOLOD content
- `Search` — filter by name
- Batch selection buttons: Select all, Clear, Select compressed, Select uncompressed, Select LOD mods
- Large mod lists are shown in pages so selecting all does not lock the Vortex window.

## Building from Source

```bash
git clone <repo>
cd mod-compressor-vortex
npm install
npm run build    # produces index.js and the native helper
npm test         # run the TypeScript test suite
npm run ci       # tests + type-check
```

The output `index.js` is the bundled extension. Deploy it with `info.json`,
`native/mod-compressor-helper.exe`, `README.md`, `CHANGELOG.md`, and the GPL
license file. If the native helper cannot start or fails its protocol check,
the extension falls back to `compact.exe`.

## How It Works

- Uses a bundled native helper for parallel file operations and per-file progress.
- Falls back to `compact.exe` when the helper is unavailable.
- Verifies the helper protocol before using it and verifies compression state
  after operations when a size summary is unavailable.
- Reads compression ratio from helper or `compact.exe` output (size-on-disk vs size-on-NTFS).
- Persists compression state per-game as JSON in `<vortexDataPath>/mod-compressor/<gameId>.json`.
- Scans files against compressible-extensions and target-directory lists.

All algorithms are NTFS-native — no special drivers or admin tools needed.

## Algorithm Reference

| Algorithm     | Ratio | Speed  | Use Case              |
|---------------|-------|--------|-----------------------|
| XPRESS4K      | 1.4x  | Fast   | Small files, textures |
| XPRESS8K      | 1.6x  | Normal | Default, good balance |
| XPRESS16K     | 1.8x  | Slow   | Dense data            |
| LZX           | 2.0x  | Slowest| Best compression      |

## License

GPL-3.0 — same as the original MO2 plugin.

See [CHANGELOG.md](CHANGELOG.md) for release notes.
