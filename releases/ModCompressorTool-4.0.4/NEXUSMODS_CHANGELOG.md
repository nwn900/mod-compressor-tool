# Mod Compressor Tool 4.0.4

## Changelog for NexusMods

This version is for Mod Organizer 2 (MO2). It saves disk space with Windows
file compression. It does not change the data inside your mod files.

This changelog compares the combined 4.0.4 package with the original MO2 4.0
plugin. The MO2 runtime remains the validated 4.0.3 build; the package also
contains the audited Vortex 1.1.0 update under `vortex/`.

## Vortex 1.1.0

- Select all keeps the full selection without freezing large Vortex mod lists;
  rows are rendered in pages.
- Scan, compress, and decompress now show file-level progress for the current
  mod.
- The native helper is shipped, protocol-checked, and falls back to
  `compact.exe` if it cannot run.
- Compression state is measured or queried after an operation instead of being
  guessed from exit code alone.
- Unsafe LOD basename matching, stale game-service state, and unbounded
  synchronous debug logging were fixed.

## What you will notice

- Large mods can compress faster on supported Windows drives.
- The tool shows real progress while it scans, compresses, or decompresses one
  mod.
- The progress bar shows the current file group and the total work.
- Selecting many mods no longer makes MO2 appear to freeze.
- Filters and mod-list refreshes no longer clear your selections.
- The tool gives a clearer result after compression or decompression.

## New features

### Faster Windows compression

- A small optional helper program can process many files at the same time.
- The helper supports XPRESS4K, XPRESS8K, XPRESS16K, and LZX.
- A `Threads` setting lets you choose `Auto` or 1 to 16 worker threads.
- MO2 uses the built-in `compact.exe` tool when the helper cannot run.

### Safer file handling

- The tool creates the exact list of files that it can change.
- It sends that same list to either compression method.
- It changes only files in the selected mod targets.
- It uses only files that MO2 identifies as belonging to an unmanaged mod.
- It skips small files and file types that do not benefit from compression.

### Better results and saved information

- The tool measures the mod after each operation.
- It reports the original size, stored size, saved space, and compression type.
- It reports sound and animation sizes in the mod list.
- It remembers more compression details between MO2 sessions.
- Old saved data converts to the new format without manual work.
- Bad saved values no longer stop the plugin from loading.

## Important fixes

- The progress bar no longer fills at the start of a one-mod job.
- Scan progress now moves as the tool reads each file.
- Compression and decompression progress now moves during the operation.
- The tool no longer reports decompression as complete when Windows still
  compresses selected files.
- Large Select all and Clear actions no longer cause long interface pauses.
- Selections stay active after a search, filter, sort, or idle refresh.
- Old entries for removed mods leave the saved list after a valid MO2 refresh.
- Native and fallback methods now use the same file scope.
- The download package includes the helper program at the required MO2 path.

## What stays the same

- The plugin still works with the four compression methods listed above.
- The plugin still has a `compact.exe` fallback.
- The plugin still asks for confirmation before it changes files.
- The Cancel button still stops an active operation.
- The plugin does not change load order, plugin records, or mod file data.
- Existing state files migrate automatically.

## Requirements and limits

- Windows and MO2 are required.
- The optional helper needs a Windows drive that supports WOF compression.
- The plugin uses `compact.exe` when WOF is not available.
- The helper is not digitally signed. Some antivirus programs can still flag
  this type of Windows compression tool.

## Testing

- 27 Python tests pass.
- 3 helper-program tests pass.
- The release package passes its layout and archive checks.
- The packaged helper answers its startup test with protocol `0.1.0`.

Test the plugin on a small disposable mod before a large compression job.
