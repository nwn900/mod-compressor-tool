# Mod Compressor: Vortex vs. MO2 Differential Analysis and Port Plan

Date: 2026-09-01

## Executive conclusion

The installed Vortex extension contains one major improvement worth porting to the MO2 plugin: a bundled Rust helper that performs direct per-file WOF operations in parallel and returns structured, exact measurements. It also improves state identity, stale-state cleanup, live mod-list refresh, selection persistence, algorithm detection, per-file error reporting, and automated test coverage.

The Vortex implementation is not a clean superset of the MO2 implementation. Several Vortex behaviors are incomplete or weaker and must not be copied blindly:

- its release workflow omits the native helper from the published archive, disabling the main improvement for a normally packaged release;
- XPRESS4K follows a different path from the other algorithms and therefore has different file-selection semantics;
- settings for automatic compression are declared but not implemented, while the page uses a separate JSON settings store;
- toolbar actions ignore the page's target, algorithm, and thread settings;
- the page lacks MO2's confirmation, cancel button, and empty-selection/empty-target validation;
- “Scan all” scans only the currently filtered rows;
- Vortex does not support unmanaged/foreign mods, while this MO2 version resolves them through MO2's file tree/origin data;
- Vortex has narrower and sometimes inconsistent game, target-directory, extension, and content-classification tables.

Recommended result: port the native helper as an optional backend behind the existing `CompactRunner`, preserve the current MO2 workload/provenance logic and UI safety, then adopt the Vortex measurement and concurrency features incrementally under tests. Do not replace the MO2 plugin wholesale with translated Vortex code.

## Scope and evidence

### Compared artifacts

| Artifact | Location | Observed version | Size / lines | SHA-256 |
|---|---|---:|---:|---|
| MO2 plugin (pre-port baseline) | `C:\Users\micha\Desktop\Projects\Mod Compressor Tool\mod_compressor_tool.py` | 4.0.0 | 95,625 bytes / 2,810 lines | `FFA0C2D2F6BA3D544FEBD0259782C738D27E57049966D7DE8C719688E47B6656` |
| Vortex runtime bundle | `C:\Users\micha\AppData\Roaming\Vortex\plugins\mod-compressor\index.js` | 1.0.0 metadata | 661,215 bytes | `D7C8078E4957A26950CAE6B140B99E03A59FB6658A912CA6AA8C0A49B902BD2B` |
| Vortex native helper | `C:\Users\micha\AppData\Roaming\Vortex\plugins\mod-compressor\native\mod-compressor-helper.exe` | helper protocol 0.1.0 | 470,016 bytes | `F2512F6A9A926D2E7D8628C0BB49CD8F02270B3641DD40DF80886D14A9CA689A` |
| Vortex source | `C:\Users\micha\AppData\Roaming\Vortex\plugins\mod-compressor\src` | package 1.0.0 | 20 TS/TSX files / 3,857 lines | per-file source inspected |
| Rust helper source | `...\native\mod-compressor-helper\src\main.rs` | 0.1.0 | 821 lines | source inspected |

The Vortex source directory is outside the requested workspace, so it was treated as read-only. During the comparison only the report was added; the subsequent implementation added the MO2-side Python, native-source, build, and test files described in the implementation-status section.

The deployed `index.js` contains the native adapter, helper lookup paths, thread option, live-refresh code, actions, and current page implementation. This establishes that the inspected TypeScript features are present in the executable Vortex bundle. The helper was also probed without changing files and returned the following relevant fields (abridged):

```json
{"ok":true,"code":0,"message":"native helper ready","version":"0.1.0","mode":"native","algorithms":["xpress4k","xpress8k","xpress16k","lzx"]}
```

The Vortex TypeScript suite contains 172 statically enumerated test cases across 17 test files, plus three Rust unit tests. Dependencies were not installed and the suites were not executed during this read-only comparison; test presence is not a current pass result.

The code graph was used at verification tier for discovery and call-path inspection. It reported no parse gaps, but later reported file-metadata changes and recommended direct reads. All material claims below were therefore checked against the current source files. `index.js` and the helper executable were deliberately excluded from graph indexing and were checked directly instead.

## Architecture comparison

### MO2 execution path

```text
ModCompressorDialog
  -> CompressionWorker in QThread
    -> MO2-aware _resolve_mod_workload
      -> managed mod: target directories
      -> foreign mod: VFS file-tree origins and winning Data files
    -> CompactRunner
      -> compact.exe once per target directory or individual foreign file
    -> Python scan / decompression verification
    -> JSON state keyed by mod name
```

Important source areas (line ranges refer to the pre-port baseline):

- constants and schemas: `mod_compressor_tool.py:148-430`
- MO2/VFS workload resolution: `mod_compressor_tool.py:481-787`
- measurement and compact-output handling: `mod_compressor_tool.py:801-1589`
- target discovery: `mod_compressor_tool.py:1592-1667`
- state and process backend: `mod_compressor_tool.py:1671-1818`
- worker: `mod_compressor_tool.py:1821-1965`
- UI and options: `mod_compressor_tool.py:1969-2727`

### Vortex execution path

```text
ModCompressorPage / mods toolbar actions
  -> resolve Vortex staging path
  -> findTargetDirs
  -> CompressionService
    -> NativeCompressionAdapter
      -> Rust helper, direct WOF calls and Rayon parallelism
      -> CompactAdapter fallback (always for XPRESS4K)
    -> exact full-root measurement
    -> atomic per-game JSON state keyed by Vortex mod ID
```

Important source areas under the installed Vortex extension root:

- registration: `src/index.ts`
- page and Vortex path resolution: `src/ModCompressorPage.tsx`
- orchestration and post-operation measurement: `src/compressionService.ts`
- native/fallback adapter: `src/nativeCompression.ts`, `src/windowsCompression.ts`
- process lifecycle: `src/processRunner.ts`
- scan/targets: `src/modScanner.ts`, `src/targetUtils.ts`, `src/constants.ts`
- state/list behavior: `src/stateStore.ts`, `src/modList.ts`, `src/uiState.ts`
- direct Windows implementation: `native/mod-compressor-helper/src/main.rs`

## Capability matrix

| Area | MO2 4.0 | Installed Vortex 1.0 | Port decision |
|---|---|---|---|
| Compression backend | `compact.exe`; sequential target calls | Rust direct WOF helper for XPRESS8K/16K/LZX; compact fallback and XPRESS4K | Port helper as optional backend; retain compact fallback |
| File parallelism | None | Rayon; auto `clamp(cpu - 2, 2, 8)`, manual 1-16 | Port with a persisted thread control |
| Mod parallelism | Sequential | Sequential | Keep sequential to limit I/O pressure and simplify cancellation |
| Measurement | Python WinAPI physical size, attributes, heuristic WOF detection | Helper reports exact logical/physical size, NTFS flag, WOF presence, and dominant algorithm | Port helper measurement and retain Python fallback |
| Operation errors | Directory-level compact exit/output | Per-file counts and path/error/code list | Port structured results and summarized UI logging |
| Decompression | Four WOF compact passes plus NTFS pass | Direct removal of WOF external backing and NTFS compression per file; compact fallback | Port direct helper path; retain verified fallback |
| Selective compression | All files beneath chosen target directories | Native helper filters to a compressible-extension allowlist; fallback does not | Define one policy and make native/fallback consistent before release |
| Unmanaged mods | Supported using MO2 file-tree origin checks against real Data files | Explicitly unsupported | Preserve MO2 behavior; never replace with Vortex staging guesses |
| State key | Mod display name | Stable Vortex mod ID, per game | Adapt, because MO2 exposes no equivalent Vortex ID in this code |
| State writes | Atomic temp + replace | Atomic temp + rename | Already equivalent |
| Stale state | Not pruned | Pruned when installed mod IDs disappear | Port safe pruning and migration logic |
| Mod-list refresh | Dialog snapshot on open | Debounced Vortex-store subscription; selection pruned, not reset | Port an MO2-appropriate idle refresh mechanism |
| Selection through filter/refresh | Filtering rebuilds the table and clears checks | `Set<modId>` survives filter/sort/refresh | Port by tracking checked mod keys outside table widgets |
| Operation confirmation | Yes | No | Preserve MO2 |
| Cancellation | Visible Cancel; terminates active compact process | Process runner can cancel internally, but page exposes no cancel | Preserve and extend MO2 cancellation to helper process |
| Empty input validation | Warns for no mods and no targets | Missing | Preserve MO2 |
| “Scan all” | All known mods after confirmation | Only filtered IDs | Preserve MO2 semantics or rename Vortex-like behavior explicitly |
| Live debug log | UI log, capped at 3,000 blocks | UI log capped at 500 plus `%TEMP%\mod-compressor-debug.log` | Optional; if ported, add rotation/size cap |
| Automated tests | No tests in workspace | 172 TS cases + 3 Rust cases; Windows CI matrix | Port tests first, adapted to Python and MO2 seams |
| Packaging | Single Python file | JS bundle plus required helper | Introduce explicit helper packaging/hash/probe checks |

## Vortex improvements worth porting

### 1. Native, parallel WOF backend

The Rust helper accepts a JSON request on stdin and emits a JSON response on stdout. Supported commands are `probe`, `measure`, `compress`, and `decompress` (`main.rs:105-154`). It recursively collects files without following links (`main.rs:212-243`) and executes operations in a bounded Rayon pool (`main.rs:276-290`).

The helper directly calls Windows APIs:

- `WofSetFileDataLocation` for WOF compression;
- `FSCTL_DELETE_EXTERNAL_BACKING` for WOF decompression;
- `FSCTL_SET_COMPRESSION` with `COMPRESSION_FORMAT_NONE` for NTFS decompression;
- `GetCompressedFileSizeW` for allocated/compressed size;
- `WofIsExternalFile` for exact WOF provider and algorithm detection.

This removes four or five `compact.exe` passes during decompression and can operate on many files concurrently. It also distinguishes “changed”, “skipped”, and “failed” files and supplies path-specific error codes.

### 2. Exact post-operation full-mod measurement

After a successful scoped operation, `CompressionService` asks the adapter to measure the full mod root (`compressionService.ts:365-405`). This avoids reporting only the selected target directories as the whole mod and refreshes type sizes, ratio, compressed flags, and algorithm in one structured result.

The helper measures all encountered files and reports:

- file count, logical size, and physical size;
- skipped-file count;
- texture, mesh, sound, LOD, animation, and other sizes;
- counts detected by NTFS attribute, physical-size reduction, and WOF provider;
- whether any compression exists;
- the most common WOF algorithm.

MO2 already has good physical-size measurement, but it cannot identify the WOF algorithm exactly and does not persist sound/animation or all debug counters.

### 3. Better state schema and identity

Vortex persists all `ModInfo` fields, including sound and animation sizes and all three compression-detection counters. Its state is separated by game and keyed by Vortex mod ID. Loading the page prunes records for mods no longer installed (`ModCompressorPage.tsx:183-202`).

MO2 already performs atomic state writes, but its state is keyed by display name. It defines `compressed_by_attr` and `compressed_by_size` yet omits both from `to_dict()` and `from_dict()`. It also lacks `sound_size` and `animation_size` fields. These schema gaps should be fixed independently of the helper port.

### 4. Live list refresh and stable UI selection

Vortex computes a signature over game ID, mod ID, name, installation path, and profile-enabled state, subscribes to store changes, debounces refresh by 500 ms, and defers refresh while an operation runs (`ModCompressorPage.tsx:204-267`). Selection is held in a separate ID set and pruned only when a mod disappears.

MO2's `_apply_filter()` rebuilds the table and initializes every checkbox unchecked, so changing a filter loses the selection. Moving selection state out of table cells is a high-value, low-risk port even without native compression.

### 5. Testable layering

The Vortex version splits parsing, targeting, state, scanning, process execution, compression orchestration, UI state, and native integration into small units. The MO2 version is a monolith. A complete module rewrite is unnecessary, but extracting pure helpers and backend protocol code will make regression tests possible.

## Exact behavioral differences

### Extension allowlists

Both versions share `.dds`, `.tga`, `.bmp`, `.nif`, `.btr`, `.bto`, `.tri`, `.wav`, `.xwm`, `.hkx`, `.kf`, `.lst`, `.btd`, and `.lod`.

MO2 additionally treats these as compressible: `.fuz`, `.lip`, `.pex`, `.seq`, `.swf`.

Vortex does not include those five. It explicitly ignores `.pex`, producing a direct policy conflict. Before porting, choose and test one policy. A conservative default is to preserve the MO2 allowlist for compatibility, but only after measuring real benefit and confirming no update/patching workflow depends on files remaining uncompressed.

The Vortex Rust helper uses its own hard-coded allowlist rather than importing the TypeScript constants. Its minimum compression size is 256 bytes, while TypeScript declares `MIN_COMPRESS_SIZE = 1024`. This duplicated policy is a maintenance defect. The MO2 port must have one canonical policy sent to, or exactly mirrored and tested against, the helper.

### Ignore lists

MO2 ignores additional compressed/document/metadata/source formats such as `.gz`, `.xz`, `.bz2`, `.meta`, `.mohidden`, `.cfg`, `.yaml`, `.yml`, `.md`, `.log`, `.doc`, `.docx`, `.rtf`, `.webp`, `.lua`, and `.js`.

Vortex additionally ignores `.hlsl`, `.fx`, `.lut`, `.html`, `.bat`, `.jar`, and `.omod`, and (conflicting with MO2) `.pex`.

The native helper ignores neither set directly; compression uses only its positive allowlist. Decompression and measurement include all files.

### Target directories

| Category | MO2-only or broader entries | Vortex-only or broader entries |
|---|---|---|
| Meshes | `meshes` | adds `meshes2`, `_1stperson`, `_1stpersonmeshes` |
| Sounds | adds `sounds` | adds `voice`; lacks `sounds` |
| LOD | adds `lod`, `terrain`, `texgen_output`, `dyndolod_output`, `lodgen`, `lodgen_output` | adds top-level `lodsettings`; otherwise narrower |
| Animations | `skse/plugins/oar`, `skse/plugins/dar`, `pandora_output` | `_1stperson/animations`, `dar`, `oar`, `pandora_engine` |

Both versions also check the same major nested LOD paths. MO2 additionally recognizes `/visinfo/` and `/vis/` as LOD indicators. The port should merge useful aliases rather than replace the MO2 table.

### Supported game identifiers

Vortex includes `skyrim` and `morrowind`, which are absent from MO2's token list. MO2 includes `fallout3vr`, `falloutnv`, `falloutnewvegas`, and `nehrimese`, which are absent or differently named in Vortex. Vortex uses `newvegas`.

Keep MO2's game detection and add only identifiers proven to match actual `mobase` game names/short names. Vortex IDs are not MO2 tokens.

### Compression semantics

MO2 sends a target directory to `compact.exe`, which recursively attempts every file under that directory. Its scan ignore/allow lists do not constrain the operation itself.

Vortex's native helper compresses only its positive allowlist and minimum-size files. However, XPRESS4K always uses `compact.exe`, and all algorithms use `compact.exe` if the helper is missing. Therefore XPRESS4K/fallback may compress files that XPRESS8K/16K/LZX native mode skips. This inconsistency must be resolved before adopting the backend.

Recommended MO2 policy: enumerate eligible files once with the existing workload/provenance logic, then pass those exact paths to either backend. This makes helper and compact fallback behavior equivalent and is especially important for unmanaged mods, where only proven winner files may be touched.

### Compression-status semantics

Vortex native measurement marks a mod compressed when any file has WOF, NTFS compression, or reduced physical size. The page display, however, often uses `totalSize > diskSize`, while filters use `info.compressed`. These can disagree.

MO2 uses explicit attribute/WOF evidence plus a ratio/file-count threshold for size-only evidence. Preserve one authoritative `compressed` field and use it consistently in table status, filters, selection, and aggregate statistics. Show ratio/savings separately.

## Vortex defects or incomplete features not to port

### Critical: release archive omits the helper

`package.json` builds the helper and copies it to `native/mod-compressor-helper.exe`. The release workflow then archives only `info.json` and `index.js`. A release created by that workflow cannot use the native backend and silently falls back to `compact.exe`.

The installed development copy does contain the helper and passed the probe. This proves the local installation's native path exists; it does not prove published archives contain it.

For MO2, the release gate must inspect the final archive, require the helper at its exact runtime-relative path, hash it, extract it to a clean directory, and run `probe` from that extracted copy.

### Dormant and split settings

`settings.ts` declares `autoCompressOnInstall`, but there is no install-event handler using it. `saveSettings()` is not called by the page. The reducer is registered under `settings_mod_compressor`, while `getSettings()` reads `state.settings.modCompressor`. The actual page persists a different `ui-options.json` file.

Do not port automatic compression or this settings architecture. Port only the concrete UI options that are used: targets, algorithm, entire-mod flag, and threads.

### Toolbar actions bypass page configuration

Vortex toolbar actions always use `DEFAULT_ALGORITHM` (XPRESS8K), pass the entire mod directory, and do not use selected targets or thread settings. They also use a separately initialized global service that may remain undefined if Vortex started without a supported game active.

MO2 has no equivalent action-bar integration, so this code should not be ported. If a future MO2 context action is added, it must call the same validated job builder as the dialog.

### Missing user-safety behavior

The Vortex page has no confirmation prompt, cancel control, or “no mods/no targets” warning. Its `ProcessRunner` supports cancellation, but the UI never invokes it. Preserve MO2's current safeguards and connect cancellation to the helper subprocess.

### Incorrect or misleading “Scan all”

Vortex `handleScanAll` selects `filteredIds`, so it scans the visible subset, not all mods. MO2 correctly asks for confirmation and scans `self._mods`. Keep MO2 behavior; optionally add a separate “Scan visible” command.

### Fallback scanner classification bug

`modScanner.ts` comments that `.wav` and `.xwm` are handled as “other”, despite `ModInfo` having `soundSize`. The native helper classifies them correctly. A Vortex installation without the helper therefore reports different content statistics. Do not reproduce this inconsistency.

### Decompression verification module is unused

`verification.ts` is exported and tested but not called by the page or `CompressionService`. Native mode relies on a post-operation measurement instead. Prefer exact measurement after decompression and keep a bounded explicit verification fallback only where exact APIs are unavailable.

### Source/release provenance caveat

The package metadata points to the [declared GitHub repository](https://github.com/nwn900/mod-compressor-vortex-extension), but that URL returned HTTP 404 during this audit. The installed local copy is therefore the authoritative compared Vortex artifact; upstream history and release contents could not be verified from that repository URL.

## MO2 strengths that must be preserved

1. **Unmanaged/foreign-mod provenance.** `_collect_foreign_mod_file_paths()` resolves winning Data files and verifies their origins before operating. A native helper must receive only these already-authorized paths; it must never recursively walk the game Data directory.
2. **Managed-mod path authority.** Keep `_get_mod_path_from_organizer()` and `_resolve_mod_workload()`. Do not import Vortex's staging-directory guesses or filename sanitization heuristics.
3. **Qt5/Qt6 compatibility and embedded-Python DLL priming.** These are MO2-specific and unrelated to the backend.
4. **Cancellation, confirmation, input validation, and busy-state controls.** Extend them to the helper rather than replacing them.
5. **Broader Bethesda token and target coverage.** Merge deliberately; do not replace with Vortex identifiers.
6. **Windows 10+ gate.** Keep it and add actual helper/volume capability probes.
7. **Reversible compact fallback.** The plugin must continue working when the helper is absent, incompatible, or fails its startup probe.

## Detailed implementation plan for a less-capable model

The implementation should be done in small, reviewable slices. Every slice must leave `mod_compressor_tool.py` usable with the old compact backend. Do not combine the helper, schema, UI, and refresh work in one change.

### Phase 0 — Freeze behavior and create a test harness

1. Record the baseline SHA-256 shown above and copy `mod_compressor_tool.py` to a separately named rollback file outside the release package.
2. Do not edit the installed Vortex extension. Copy only the helper source/binary into a new MO2-owned staging area when authorized.
3. Create Python tests that import the plugin with stub `mobase`, PyQt5/PyQt6, and organizer objects. Do not require a real MO2 process for pure tests.
4. Add pure-function tests before changing code:
   - compact ratio and storage-size parsing for English, comma decimal, cp866, cp1251, and malformed output;
   - target path normalization and matching;
   - target directory discovery, including `Data`, LOD nesting, worldspaces, and junction exclusion;
   - extension policy and minimum-size boundary;
   - `ModInfo` old-schema migration and round trip;
   - state atomic-save failure behavior;
   - foreign-mod file list contains only files whose MO2 origin matches the selected mod.
5. Add a fake backend with deterministic `probe`, `measure`, `compress`, `decompress`, timeout, error, and cancellation responses.

Acceptance gate: baseline tests pass without the native helper and without changing current runtime behavior.

### Phase 1 — Fix and version the state schema

Edit `ModInfo` and its serializers around `mod_compressor_tool.py:362-422`.

1. Add `sound_size: int = 0` and `animation_size: int = 0`.
2. Persist and restore `compressed_by_attr`, `compressed_by_size`, and `compressed_by_wof`.
3. Preserve `last_mtime`; Vortex lacks it but MO2 already uses it as useful scan metadata.
4. Add a top-level schema version to the state file, or make `StateManager.load()` accept both the legacy raw mapping and a versioned structure.
5. Never discard a readable legacy state file. Missing fields must default to zero.
6. Add optional `source_path` to support stale-entry diagnosis and conservative rename migration. Do not automatically merge two records solely because their display names are similar.
7. On dialog load, identify stale keys but only prune them after a successful current mod-list read and atomic save. Log the count.

Acceptance gate: a legacy state fixture loads, saves, reloads, and preserves all old values while adding defaults for new fields.

### Phase 2 — Define one backend protocol

Keep `CompactRunner`; add a sibling `NativeHelperRunner`. Do not put helper-specific branches throughout the UI.

Use a small result model, for example:

```python
@dataclass
class BackendResult:
    ok: bool
    code: int
    message: str = ""
    processed: int = 0
    changed: int = 0
    skipped: int = 0
    failed: int = 0
    errors: List[dict] = field(default_factory=list)
    stats: Optional[ModInfo] = None
```

Required backend methods:

```text
probe() -> capability/version/algorithm result
compress(paths, algorithm, threads, eligible_only=True) -> BackendResult
decompress(paths, threads) -> BackendResult
measure(paths) -> BackendResult with stats
cancel() -> terminate active process and prevent new work
```

1. Locate the helper relative to `__file__`, not the current working directory.
2. Start it with `shell=False`, hidden window flags, explicit stdin/stdout/stderr pipes, and a bounded timeout.
3. Send one JSON request and parse only the final non-empty stdout line as JSON, matching Vortex behavior.
4. Validate response shape, protocol version, supported algorithms, numeric ranges, and error-list type before trusting it.
5. If probe fails, log the reason once and use `CompactRunner` for the session.
6. Do not silently switch backends halfway through a mod after some files changed. Finish that mod as failed/partial, measure it, and use fallback only for the next untouched mod unless the user explicitly retries.

Acceptance gate: fake-helper tests cover success, malformed JSON, missing executable, nonzero exit with/without stdout, timeout, cancel, unsupported protocol, and partial per-file failure.

### Phase 3 — Establish a single file-selection policy

This phase is mandatory before enabling native writes.

1. Create one canonical function that receives a `ModWorkload`, selected targets, and operation mode and returns exact file paths.
2. For managed mods, enumerate beneath the already resolved target directories without following symlinks/junctions.
3. For foreign mods, reuse `workload.operation_items` exactly. Never ask the helper to recurse `workload.root` when it is the game Data directory.
4. For compression, apply one documented allowlist and `MIN_COMPRESS_SIZE`. Decide explicitly whether `.fuz`, `.lip`, `.pex`, `.seq`, and `.swf` remain eligible. Add a test for each disputed extension.
5. For decompression, include every owned file under the selected targets, not only the compression allowlist, so files compressed by an older version can be restored.
6. Deduplicate case-insensitively and normalize absolute paths.
7. Pass the same exact path list to native and compact backends. For compact fallback, batch explicit file paths below the Windows command-line limit instead of recursively processing the directory.
8. Keep measurement separate: measure the full owned workload after each operation, not merely the eligible compression subset.

Acceptance gate: native and compact fake backends receive identical path sets for every target/managed/foreign test matrix.

### Phase 4 — Bring in the native helper safely

1. Copy the audited Rust source into an MO2-owned `native/mod-compressor-helper` source directory, preserving GPL-3.0 notices and documenting provenance.
2. Review/build the helper rather than treating the existing executable as unexplained binary input.
3. Correct the helper's `MIN_COMPRESS_SIZE` mismatch and duplicated extension list. Prefer sending an explicit file list from Python; then the helper does not need to make policy decisions.
4. Keep `WalkDir.follow_links(false)` as defense in depth, but do not rely on it instead of Python provenance filtering.
5. Retain bounded thread behavior: `0 = auto`, auto range 2-8, manual range 1-16.
6. Ensure cancellation terminates the one helper process and that no detached worker survives.
7. Return only bounded error detail to the UI (first 5-20 paths) while preserving a full, size-capped diagnostic log.
8. Measure after compress and decompress, including after partial failure.

Acceptance gate: helper unit tests pass; protocol tests pass; a clean extracted package probes the helper successfully.

### Phase 5 — Integrate the backend into `CompressionWorker`

Modify the worker around `mod_compressor_tool.py:1821-1965` without changing how workloads are resolved.

1. Add `threads` and backend choice/capability to the worker constructor.
2. Resolve `ModWorkload` exactly as today.
3. Build the exact owned path list from Phase 3.
4. Send one multi-path request per mod, not one process per file or target directory.
5. Emit progress at mod boundaries and, if the helper protocol is later extended, bounded file-count updates. Do not fake per-file progress from a blocking request.
6. On success, call `measure()` for the full workload and populate state from measured facts.
7. On partial failure, mark the mod as partial/error, store the measured final state, and list a bounded sample of failed paths. Do not overwrite measured state with the requested algorithm blindly.
8. On decompression, success requires a post-measure result with no WOF/NTFS evidence in the owned selected scope. Do not use only `ratio < 1.15`.
9. Keep the current cancel button and thread cleanup. Ensure `finished` fires exactly once on every path.

Acceptance gate: one selected mod invokes one helper process plus one measurement process, state reflects measured final state, and cancellation returns the UI to an enabled state.

### Phase 6 — Add thread control and backend visibility to the MO2 UI

Modify UI/options around `mod_compressor_tool.py:2068-2122` and `2544-2604`.

1. Add a spin box labeled `Threads`, range 0-16, value 0, special text `Auto` for zero.
2. Persist it as `threads`; clamp malformed saved values.
3. Disable it while a job runs along with the other options.
4. Show `Backend: Native helper 0.1.x` or `Backend: compact.exe fallback` near the status area.
5. Preserve confirmation dialogs, Cancel, empty-selection, and empty-target checks.
6. Add the new content fields only where useful; do not clutter the table. A tooltip/details dialog may show sound/animation and detection counts.

Acceptance gate: options survive close/reopen; malformed options do not crash; cancel remains reachable while running.

### Phase 7 — Preserve selection and refresh the MO2 list safely

1. Add `self._checked_mod_keys: Set[str]` independent of table cells.
2. Update it on checkbox changes and before rebuilding the table.
3. `_apply_filter()` must restore checks for still-existing visible mods instead of resetting every row.
4. Compute a lightweight signature from current mod name, normalized resolved path, and active state.
5. Use an MO2-supported event if verified against the installed API. If no reliable event is available, use a low-frequency Qt timer or a manual Refresh button; refresh only while idle.
6. Debounce/defer refresh during scan/compress/decompress.
7. After refresh, retain selected keys that still exist and log pruned selections/stale state counts.
8. Keep “Scan all” as all mods. If adding filtered behavior, label it “Scan visible”.

Acceptance gate: changing filters, sorting, active state, or installing/removing a mocked mod preserves valid selections and never refreshes during an active write.

### Phase 8 — Packaging and release gates

The final package must include at least:

```text
plugins/mod_compressor_tool.py
plugins/native/mod-compressor-helper.exe
LICENSE / helper notices as required
```

1. Build the helper reproducibly with pinned Rust dependencies from `Cargo.lock`.
2. Build x64 Windows output compatible with supported MO2 installations.
3. Generate SHA-256 hashes for the Python plugin and helper.
4. Inspect archive paths for traversal/absolute entries.
5. Extract to a clean temporary directory and run helper `probe` there.
6. Load the Python plugin with MO2/PyQt stubs from the extracted layout.
7. Verify fallback behavior by renaming the extracted helper temporarily and rerunning the stub load; do not alter a deployed installation.
8. Do not repeat the Vortex workflow defect: make the release job fail if the helper is absent.

Acceptance gate: both native and fallback package tests pass from the extracted artifact, and the manifest hashes match.

### Phase 9 — Runtime validation matrix

Static tests and hashes do not prove WOF behavior. Use disposable test mods or a duplicated MO2 profile and retain pre-test hashes/backups.

Minimum matrix:

| Case | Backend | Algorithm | Scope | Required observation |
|---|---|---|---|---|
| Managed small fixture | Native | each of 4 | textures only | only eligible texture files change; exact algorithm detected |
| Managed mixed fixture | Native | XPRESS8K | entire mod | policy-disallowed files remain unchanged |
| Managed fixture | Compact fallback | each of 4 | same scopes | exact selected path set matches native behavior |
| Foreign/unmanaged fixture | Both | XPRESS8K | one category | only MO2-proven winning files change |
| Already compressed | Native | same/different algorithm | selected scope | same algorithm skips; algorithm change is measured correctly |
| Decompress | Both | n/a | selected and all | WOF and NTFS evidence removed only from owned selected files |
| Partial access denial | Native | XPRESS8K | mixed | bounded per-file errors, measured final state, no false success |
| Cancel | Native and fallback | LZX | large fixture | process stops, UI recovers, measured partial state retained |
| Junction/symlink | Both | XPRESS8K | entire mod | target outside mod is untouched |
| Non-NTFS/unsupported | Both | any | fixture | clear preflight/failure, no false compressed state |

For each case capture:

- before/after logical and allocated size;
- file attributes and exact WOF algorithm where available;
- before/after content hashes (content must be unchanged by transparent compression);
- helper/compact exit and structured error data;
- state JSON;
- process-lifetime observation after cancel and dialog close.

Final deployment requires at least one live Skyrim/MO2 smoke test after the filesystem matrix. Do not infer game compatibility from helper tests alone.

## Suggested implementation slices

Use this order so each change is reviewable and reversible:

1. Tests and stubs only.
2. State schema round-trip fixes only.
3. Selection persistence only.
4. Pure exact-path selection and policy tests only.
5. Backend protocol plus fake helper only.
6. Rust helper source/build/probe only.
7. Worker native integration behind an off-by-default feature flag.
8. Thread UI and backend status.
9. Live/idle mod-list refresh.
10. Packaging gates.
11. Filesystem A/B matrix.
12. Enable native backend by default only after the matrix passes.

After every slice, rerun all earlier tests. Never refactor unrelated Qt/MO2 compatibility code in the same slice.

## Definition of done

The port is complete only when all of the following are true:

- the native helper is optional, probed, versioned, and present in the final extracted package;
- native and compact fallback receive the same exact authorized file paths;
- foreign mods still use MO2 origin/winner evidence and never trigger a recursive Data-directory walk;
- all four algorithms have consistent selection semantics;
- compression and decompression state comes from post-operation measurement, not requested intent;
- sound/animation and detection counters persist across state reloads;
- selection survives filter/sort/idle refresh;
- confirmation, cancel, busy-state, and input validation still work;
- cancellation leaves no child process and records a measured partial state;
- legacy state/options files migrate without data loss;
- archive inspection, extracted helper probe, stub import, native tests, fallback tests, filesystem A/B tests, and a real MO2/game smoke test all pass;
- no deployed MO2 profile or real mod directory is modified until the disposable-profile gates pass.

## Final recommendation

Port the Vortex native helper, structured measurement, persisted thread control, state-schema completeness, stable selection, stale-state pruning, and idle list refresh. Adapt them to the existing MO2 workload resolver rather than translating Vortex's staging logic. Preserve MO2's unmanaged-mod provenance, broader targeting, confirmation, cancellation, and fallback behavior. Treat packaging and native/fallback path equivalence as release-blocking requirements.

## Implementation status (2026-09-01)

The plan has been implemented in this workspace as follows:

- `mod_compressor_tool.py` now has a versioned JSON native-helper client with probe, algorithm advertisement checks, bounded error parsing, timeout/cancel handling, explicit-path compression/decompression, and post-operation measurement. It falls back to `compact.exe` for the same exact path list when the helper is absent or incompatible.
- `CompressionWorker` now resolves MO2 workloads once, preserves foreign-mod origin filtering, performs one backend operation per mod, measures the final state, records partial failures, and requires the selected scope to have no WOF/NTFS evidence after decompression.
- `ModInfo` persists sound/animation sizes, all compression-detection counters, and a normalized `source_path`. `StateManager` accepts the legacy raw mapping, writes a versioned `{schema_version, mods}` wrapper, and keeps malformed values from crashing the UI. Stale state entries are pruned only after a successful MO2 mod-list read.
- The UI now persists a `Threads` control (`0`/`Auto` through `16`), displays the selected backend, retains selections across filtering/sorting/idle mod-list refresh, and avoids refreshing during active work. Existing confirmation, empty-input, cancel, and target validation remain in place.
- `native/mod-compressor-helper/` contains the audited Rust helper source, `Cargo.toml`, a copied `Cargo.lock`, and a build script. The helper accepts `explicit: true` so Python's allowlist/provenance policy is authoritative while `WalkDir` remains a defense-in-depth directory walker.
- `tests/test_mod_compressor_tool.py` covers schema migration, malformed state/protocol data, explicit path policy, foreign provenance scope, helper request shape, category accounting, fallback arguments, protocol capability checks, timeout/cancel behavior, options persistence, selection persistence, worker operation/measurement orchestration, terminal failure signaling, and strict decompression verification. The suite currently passes 22 tests.

The locked native executable was built locally with the existing Rust 1.95 MSVC toolchain, and the three Rust unit tests pass. The helper probe and a read-only measurement probe both returned protocol `0.1.0` successfully; `scripts\validate-package.ps1` also passed its layout/hash gate. Disposable filesystem A/B tests, cancellation process-lifetime testing, and a real MO2/game smoke test remain release gates and are intentionally not claimed here. The source provenance is the installed Vortex helper under `%APPDATA%\Vortex\plugins\mod-compressor\native\mod-compressor-helper`; its GPL-3.0 package metadata is retained in the MO2-side Cargo manifest/README.

Current source and built-helper hashes:

| File | SHA-256 |
|---|---|
| `mod_compressor_tool.py` | `778B29BD11508C1C38FB094849A80DD0BA77A55A68DE688E186FA330E2A05B56` |
| `tests/test_mod_compressor_tool.py` | `0D033558C7F76806E105437EF76CB82DBFB9FF1957D9F3A2B9B7BDEC0B9747DC` |
| `native/mod-compressor-helper/src/main.rs` | `167EFDFB893E178A04F38DC80236F6F88E66B9E0D38E6F3668E6EA01CA9A29A7` |
| `native/mod-compressor-helper/Cargo.toml` | `30D1952E3FBFDB45528C3AA67C3B0BDD8CB5F06731FFBC7CD8A3F12993A96059` |
| `native/mod-compressor-helper/Cargo.lock` | `71B04B2ED7E759595134FD656BB81186EC32803A4BD322DF05ABA1CC63FA3F7D` |
| `native/README.md` | `3EC80049A8079E47834C41DF42258E7FE74455677B958AE684ED9412008EBCD6` |
| `native/build-helper.ps1` | `2B4547DE250BB8F3159FCF456580AC92A6A8F6E0FDE4065332CF5EB1051435D6` |
| `scripts/validate-package.ps1` | `22DEFF72A05E09228E117C3F22B95FE1FDCEE121316A4EA48BECF5A25EDA0B89` |
| `native/mod-compressor-helper.exe` | `A2391AF9B52F5F8BC68ABBD6D6FF89673FBE7D736F8111D9547FFC322A1A45E6` |
