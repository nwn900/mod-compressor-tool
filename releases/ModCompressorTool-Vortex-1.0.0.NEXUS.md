# Nexus Mods upload notes — Mod Compressor Vortex 1.0.0

This note is for the publisher. It is not part of the Vortex upload archive.

## File to upload

Upload only:

`releases/ModCompressorTool-Vortex-1.0.0.zip`

The archive root contains `info.json`, `index.js`, `gameart.png`, `native/`,
`README.md`, `CHANGELOG.md`, and `LICENSE-GPL-3.0.txt`. The artwork is a 640x360
PNG and is kept beside the two runtime entry files. There is no enclosing
`vortex/` folder, MO2 `plugins/` tree, source tree, nested archive, or password.

## Nexus form

- Area: **Modding Tools** (`site`).
- Category: select the current **Vortex Extensions** category shown by the
  uploader. Older wiki pages use different labels for the same area.
- File version: **1.0.0**, exactly matching `info.json`.
- Main File: use one Main File for the extension listing/review route.
- Description: state that this is a Windows/NTFS utility for Bethesda mods,
  requires Vortex 1.0.0+, bundles an unsigned native helper, and falls back to
  `compact.exe` when the helper is unavailable.
- Changelog: use the included `CHANGELOG.md` text.
- Description: use [`ModCompressorTool-Vortex-1.0.0.NEXUS_DESCRIPTION.bbcode`](ModCompressorTool-Vortex-1.0.0.NEXUS_DESCRIPTION.bbcode).

## Checks before submission

1. Run `scripts/validate-vortex-package.ps1` against the release directory and
   ZIP.
2. Confirm the archive opens with `info.json` and `index.js` at its top level.
   Confirm `gameart.png` is also at the top level and is 640x360 PNG under 1 MB.
3. Test installation in a clean Vortex profile and test one small mod before
   testing a large list.
4. Keep the SHA-256 value from the adjacent `.sha256` file for support and
   antivirus investigations.

Recorded hashes for this build:

```text
index.js
  SHA-256 7E8C2FE044B78E18FC9FC5D39A54A22037DF48584D40DE0F53B75EBB6BF0B610
native/mod-compressor-helper.exe
  SHA-256 7A921C4C96500313DFFF02CFA038320347B0627B12463E022ABC7541FFF67E34
ModCompressorTool-Vortex-1.0.0.zip
  SHA-256 7C3CE95B2EC667EFB06475C031AE1AEC98B5620360F42CAC4C15BC191C05ADB5
```

Nexus scans executable content. If a scanner reports a false positive, keep
the exact file and hash available, provide the public source and provenance,
and contact Nexus moderation and the antivirus vendor. Do not obfuscate or
repack the helper to evade scanning.
