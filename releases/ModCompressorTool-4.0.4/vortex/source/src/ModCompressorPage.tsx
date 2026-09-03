import * as React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { IExtensionApi, util, selectors } from 'vortex-api';
import { CompressionService } from './compressionService';
import { StateStore } from './stateStore';
import { NativeCompressionAdapter } from './nativeCompression';
import {
  TargetType,
  TARGET_NAMES,
  CompressionAlgorithm,
  COMPRESSION_ALGORITHMS,
  DEFAULT_ALGORITHM,
} from './types';
import {
  ModRow,
  FilterState,
  UiOptions,
  filterMods,
  selectCompressed,
  selectUncompressed,
  selectLodMods,
  getSelectedTargets,
  LOD_TAG_THRESHOLD,
} from './uiState';
import { formatSize, formatRatio, getContentTags } from './format';
import { getStagingDirCandidates } from './stagingDir';
import { findTargetDirs } from './modScanner';
import {
  buildModRows,
  createModListSignature,
  pruneSelectedIds,
} from './modList';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface Props {
  api: IExtensionApi;
}

interface State {
  modRows: ModRow[];
  filteredIds: string[];
  selectedIds: Set<string>;
  service: CompressionService | null;
  loading: boolean;
  running: boolean;
  progress: { done: number; total: number; text: string };
  log: string[];
  filter: FilterState;
  options: UiOptions;
  startTime: number | null;
  elapsed: number;
  sortKey: string;
  sortDir: 'asc' | 'desc';
  page: number;
}

const TARGET_OPTIONS: { key: TargetType; label: string }[] = [
  { key: TargetType.TEXTURES, label: 'Textures' },
  { key: TargetType.MESHES, label: 'Meshes' },
  { key: TargetType.SOUNDS, label: 'Sounds' },
  { key: TargetType.LOD, label: 'LOD/DynDOLOD' },
  { key: TargetType.ANIMATIONS, label: 'Animations' },
];

const ALGO_OPTIONS: { key: CompressionAlgorithm; label: string }[] = [
  { key: CompressionAlgorithm.XPRESS4K, label: 'XPRESS4K (Fastest)' },
  { key: CompressionAlgorithm.XPRESS8K, label: 'XPRESS8K (Default)' },
  { key: CompressionAlgorithm.XPRESS16K, label: 'XPRESS16K' },
  { key: CompressionAlgorithm.LZX, label: 'LZX (Best ratio)' },
];

// Keep the selection model complete while rendering a bounded number of
// checkbox nodes. Rendering every mod at once can block Vortex when a large
// list is selected in one click.
const ROWS_PER_PAGE = 200;

export class ModCompressorPage extends React.Component<Props, State> {
  _timerInterval: number | null = null;
  _modListRefreshTimer: number | null = null;
  _unsubscribeStore: (() => void) | null = null;
  _modListSignature = '';
  _stateStore: StateStore | null = null;
  _pendingModListRefreshReason: string | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      modRows: [],
      filteredIds: [],
      selectedIds: new Set(),
      service: null,
      loading: true,
      running: false,
      progress: { done: 0, total: 0, text: '' },
      log: [],
      filter: {
        activeOnly: false,
        compressedOnly: false,
        uncompressedOnly: false,
        lodOnly: false,
        searchQuery: '',
      },
      options: {
        targets: [TargetType.TEXTURES, TargetType.MESHES, TargetType.LOD],
        algorithm: DEFAULT_ALGORITHM,
        entireMod: false,
        threads: 0,
      },
      startTime: null,
      elapsed: 0,
      sortKey: 'name',
      sortDir: 'asc',
      page: 0,
    };
  }

  componentDidMount(): void {
    void this.initializeService();
    void this.loadOptions();
    this.subscribeToModListChanges();
  }

  componentWillUnmount(): void {
    this.stopTimer();
    if (this._modListRefreshTimer !== null) {
      clearTimeout(this._modListRefreshTimer);
      this._modListRefreshTimer = null;
    }
    if (this._unsubscribeStore) {
      this._unsubscribeStore();
      this._unsubscribeStore = null;
    }
  }

  componentDidUpdate(prevProps: Props, prevState: State): void {
    if (prevState.modRows !== this.state.modRows || prevState.filter !== this.state.filter) {
      const filtered = filterMods(this.state.modRows, this.state.filter);
      this.setState({ filteredIds: filtered.map((r) => r.id), page: 0 });
    }
    if (prevState.options !== this.state.options) {
      void this.saveOptions();
    }
    if (prevState.running && !this.state.running && this._pendingModListRefreshReason) {
      const reason = this._pendingModListRefreshReason;
      this._pendingModListRefreshReason = null;
      this.queueModListRefresh(reason);
    }
  }

  async initializeService(): Promise<void> {
    const { api } = this.props;
    try {
      const state = api.getState();
      const gameId = selectors.activeGameId(state) ?? '';
      if (!gameId) {
        this.setState({ loading: false });
        return;
      }

      const userDataPath = util.getVortexPath('userData');
      const store = new StateStore(userDataPath);
      const adapter = new NativeCompressionAdapter();
      const svc = new CompressionService(adapter, store);
      this._stateStore = store;
      this.debugLog(`compression adapter mode: ${adapter.getMode()}`);

      const rows = await this.loadModRows(gameId, store, state);
      const filtered = filterMods(rows, this.state.filter);
      this._modListSignature = this.getCurrentModListSignature();
      this.setState((prev) => ({
        modRows: rows,
        filteredIds: filtered.map((r) => r.id),
        selectedIds: pruneSelectedIds(prev.selectedIds, rows),
        service: svc,
        loading: false,
      }));
    } catch (err) {
      console.error('mod-compressor: init error', err);
      this.setState({ loading: false });
    }
  }

  private async loadModRows(gameId: string, store: StateStore, state: any): Promise<ModRow[]> {
    const persistent = state?.persistent?.mods?.[gameId] ?? {};
    const activeProfile = selectors.activeProfile(state);
    const profileMods = activeProfile?.modState ?? {};
    const savedInfo = await store.load(gameId);
    const validIds = new Set(
      Object.entries(persistent)
        .filter(([, entry]: [string, any]) => Boolean(entry?.installationPath))
        .map(([modId]) => modId),
    );
    const prunedInfo = Object.fromEntries(
      Object.entries(savedInfo).filter(([modId]) => validIds.has(modId)),
    );
    if (Object.keys(prunedInfo).length !== Object.keys(savedInfo).length) {
      await store.save(gameId, prunedInfo);
      this.debugLog(`pruned stale saved mod info: before=${Object.keys(savedInfo).length} after=${Object.keys(prunedInfo).length}`);
    }

    return buildModRows({ persistentMods: persistent, profileMods, savedInfo: prunedInfo });
  }

  private getCurrentModListSignature(): string {
    const state = this.props.api.getState();
    const gameId = selectors.activeGameId(state) ?? '';
    const persistentMods = state?.persistent?.mods?.[gameId] ?? {};
    const profileMods = selectors.activeProfile(state)?.modState ?? {};
    return createModListSignature({ gameId, persistentMods, profileMods });
  }

  private subscribeToModListChanges(): void {
    const store = this.props.api.store;
    if (!store || typeof store.subscribe !== 'function') {
      this.debugLog('mod list live refresh unavailable: api.store.subscribe missing');
      return;
    }

    this._modListSignature = this.getCurrentModListSignature();
    this._unsubscribeStore = store.subscribe(() => {
      const nextSignature = this.getCurrentModListSignature();
      if (nextSignature === this._modListSignature) {
        return;
      }

      this._modListSignature = nextSignature;
      this.queueModListRefresh('vortex state changed');
    });
    this.debugLog('mod list live refresh subscribed to Vortex store');
  }

  private queueModListRefresh(reason: string): void {
    if (this._modListRefreshTimer !== null) {
      clearTimeout(this._modListRefreshTimer);
    }

    this._modListRefreshTimer = window.setTimeout(() => {
      this._modListRefreshTimer = null;
      void this.refreshModRows(reason);
    }, 500);
  }

  private async refreshModRows(reason: string): Promise<void> {
    const { service, running } = this.state;
    if (!service || !this._stateStore) return;
    if (running) {
      this._pendingModListRefreshReason = reason;
      return;
    }

    try {
      const state = this.props.api.getState();
      const gameId = selectors.activeGameId(state) ?? '';
      if (!gameId) return;

      const rows = await this.loadModRows(gameId, this._stateStore, state);
      const filtered = filterMods(rows, this.state.filter);
      this.setState((prev) => ({
        modRows: rows,
        filteredIds: filtered.map((r) => r.id),
        selectedIds: pruneSelectedIds(prev.selectedIds, rows),
      }));
      this.debugLog(`mod list refreshed: ${reason}; rows=${rows.length}`);
    } catch (err: any) {
      this.debugLog(`mod list refresh failed: ${err?.message ?? String(err)}`);
    }
  }

  getSelectedMods(): ModRow[] {
    return this.state.modRows.filter((r) => this.state.selectedIds.has(r.id));
  }

  optionsPath(): string {
    return path.join(util.getVortexPath('userData'), 'mod-compressor', 'ui-options.json');
  }

  async loadOptions(): Promise<void> {
    try {
      const optsPath = this.optionsPath();
      if (fs.existsSync(optsPath)) {
        const raw = fs.readFileSync(optsPath, 'utf-8');
        const saved = JSON.parse(raw) as UiOptions;
        this.setState((prev) => ({
          options: { ...prev.options, ...saved },
        }));
      }
    } catch (err) {
      console.error('mod-compressor: failed to load UI options', err);
    }
  }

  async saveOptions(): Promise<void> {
    try {
      const optsPath = this.optionsPath();
      const dir = path.dirname(optsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(optsPath, JSON.stringify(this.state.options, null, 2), 'utf-8');
    } catch (err) {
      console.error('mod-compressor: failed to save UI options', err);
    }
  }

  startTimer(): void {
    this.setState({ startTime: Date.now(), elapsed: 0 });
    this._timerInterval = window.setInterval(() => {
      this.setState((prev) => {
        if (prev.startTime === null) return null;
        return { elapsed: Math.floor((Date.now() - prev.startTime) / 1000) };
      });
    }, 1000);
  }

  stopTimer(): void {
    if (this._timerInterval !== null) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
    // keep elapsed visible — don't clear it
  }

  handleScan = async (): Promise<void> => {
    const { service, running } = this.state;
    if (!service || running) return;
    this.setState({ running: true, log: [], elapsed: 0, progress: { done: 0, total: 1, text: 'Preparing scan...' } });
    this.startTimer();
    const selected = this.getSelectedMods();

    for (let i = 0; i < selected.length; i++) {
      const mod = selected[i];
      this.setState({ progress: { done: 0, total: 1, text: `Scanning: ${mod.name}` } });
      this.appendLog(`Scanning: ${mod.name}...`);

      try {
        const gameId = selectors.activeGameId(this.props.api.getState()) ?? '';
        const modPath = await this.resolveModPath(mod);
        if (!modPath) {
          this.appendLog(`  [SKIP] ${mod.name}: path not found`);
          this.setState({ progress: { done: 1, total: 1, text: `Skipped: ${mod.name}` } });
          continue;
        }
        this.appendLog(`  path: ${modPath}`);
        this.debugLog(`scan: ${mod.name} @ ${modPath}`);
        const onProgress = (done: number, total: number): void => {
          const safeTotal = Math.max(1, total);
          const safeDone = Math.max(0, Math.min(done, safeTotal));
          this.setState({ progress: { done: safeDone, total: safeTotal, text: `Scanning: ${mod.name} (${safeDone}/${safeTotal})` } });
        };
        const info = await service.scanAndSave(modPath, gameId, mod.id, { onProgress });
        this.setState((prev) => ({
          progress: { done: prev.progress.total || 1, total: prev.progress.total || 1, text: `Scanned: ${mod.name}` },
        }));
        this.debugLog(`scan result: compressed=${info.compressed} ratio=${info.ratio} totalSize=${info.totalSize} diskSize=${info.diskSize}`);
        this.appendLog(`  ${mod.name}: ${info.compressed ? 'compressed' : 'not compressed'}, ratio=${formatRatio(info.ratio)}`);
        this.setState((prev) => ({
          modRows: prev.modRows.map((r) => (r.id === mod.id ? { ...r, info } : r)),
        }));
      } catch (err: any) {
        this.appendLog(`  [ERR] ${mod.name}: ${err?.message ?? 'Unknown error'}`);
      }
    }

    this.stopTimer();
    this.setState({ progress: { done: 0, total: 0, text: '' }, running: false });
    this.appendLog('Scan complete');
  };

  handleScanAll = (): void => {
    const { filteredIds } = this.state;
    this.setState({ selectedIds: new Set(filteredIds) }, () => {
      setTimeout(() => void this.handleScan(), 100);
    });
  };

  handleCompress = async (): Promise<void> => {
    const { service, options, running } = this.state;
    if (!service || running) return;
    this.setState({ running: true, log: [], elapsed: 0 });
    this.startTimer();
    const selected = this.getSelectedMods();
    const targets = getSelectedTargets(options);
    const algo = options.algorithm;

    this.appendLog(`Compressing ${selected.length} mods with ${algo}...`);
    if (!options.entireMod) {
      this.appendLog(`Targets: ${targets.map((t) => TARGET_NAMES[t]).join(', ')}`);
    }

    for (let i = 0; i < selected.length; i++) {
      const mod = selected[i];
      this.setState({ progress: { done: 0, total: 1, text: `Compressing: ${mod.name}` } });

      try {
        const gameId = selectors.activeGameId(this.props.api.getState()) ?? '';
        const modPath = await this.resolveModPath(mod);

        if (!modPath) {
          this.appendLog(`  [SKIP] ${mod.name}: path not found`);
          this.setState({ progress: { done: 1, total: 1, text: `Skipped: ${mod.name}` } });
          continue;
        }

        this.appendLog(`  path: ${modPath}`);
        const targetPaths = findTargetDirs(modPath, targets);
        if (targetPaths.length === 0) {
          this.appendLog(`  [SKIP] ${mod.name}: no selected target directories found`);
          this.debugLog(`compress skip: ${mod.name} @ ${modPath} targets=${targets.join(',')} no matching directories`);
          this.setState({ progress: { done: 1, total: 1, text: `Skipped: ${mod.name}` } });
          continue;
        }

        this.appendLog(`  targets: ${targetPaths.length}`);
        this.debugLog(`compress start: ${mod.name} @ ${modPath} algo=${algo} targets=${targetPaths.join('|')}`);

        const onProgress = (done: number, total: number): void => {
          const safeTotal = Math.max(1, total);
          const safeDone = Math.max(0, Math.min(done, safeTotal));
          this.setState({ progress: { done: safeDone, total: safeTotal, text: `Compressing: ${mod.name} (${safeDone}/${safeTotal})` } });
        };
        const result = await service.compressModPaths(
          targetPaths,
          algo as CompressionAlgorithm,
          { modId: mod.id, measureRoot: modPath, threads: options.threads, onProgress },
          gameId,
          mod.info,
        );

        this.setState((prev) => ({
          modRows: prev.modRows.map((r) => (r.id === mod.id ? { ...r, info: result.modInfo, contentTags: getContentTags(result.modInfo), hasLod: result.modInfo.lodSize > LOD_TAG_THRESHOLD } : r)),
        }));

        this.debugLog(`compress result: code=${result.code} stdout=${result.output} stderr=${result.stderr}`);

        this.setState((prev) => ({
          progress: { done: prev.progress.total || 1, total: prev.progress.total || 1, text: `Finished: ${mod.name}` },
        }));

        if (result.code === 0) {
          this.appendLog(`  [OK] ${mod.name}: saved ${formatSize(result.modInfo.totalSize - result.modInfo.diskSize)}`);
        } else {
          const errLines = (result.stderr || '').split('\n').map(s => s.trim()).filter(Boolean);
          const outLines = (result.output || '').split('\n').map(s => s.trim()).filter(Boolean);
          this.appendLog(`  [ERR] ${mod.name}: exit code ${result.code}`);
          if (errLines.length) this.appendLog(`  stderr: ${errLines.slice(0, 5).join(' | ')}`);
          if (outLines.length) this.appendLog(`  stdout: ${outLines.slice(0, 5).join(' | ')}`);
        }
      } catch (err: any) {
        this.appendLog(`  [ERR] ${mod.name}: ${err?.message ?? 'Unknown error'}`);
      }
    }

    this.stopTimer();
    this.appendLog('Compression complete');
    this.setState({ progress: { done: 0, total: 0, text: '' }, running: false });
  };

  handleDecompress = async (): Promise<void> => {
    const { service, options, running } = this.state;
    if (!service || running) return;
    this.setState({ running: true, log: [], elapsed: 0 });
    this.startTimer();
    const selected = this.getSelectedMods();
    const targets = getSelectedTargets(options);

    this.appendLog(`Decompressing ${selected.length} mods...`);
    if (!options.entireMod) {
      this.appendLog(`Targets: ${targets.map((t) => TARGET_NAMES[t]).join(', ')}`);
    }

    for (let i = 0; i < selected.length; i++) {
      const mod = selected[i];
      this.setState({ progress: { done: 0, total: 1, text: `Decompressing: ${mod.name}` } });

      try {
        const gameId = selectors.activeGameId(this.props.api.getState()) ?? '';
        const modPath = await this.resolveModPath(mod);

        if (!modPath) {
          this.appendLog(`  [SKIP] ${mod.name}: path not found`);
          this.setState({ progress: { done: 1, total: 1, text: `Skipped: ${mod.name}` } });
          continue;
        }

        this.appendLog(`  path: ${modPath}`);
        const targetPaths = findTargetDirs(modPath, targets);
        if (targetPaths.length === 0) {
          this.appendLog(`  [SKIP] ${mod.name}: no selected target directories found`);
          this.debugLog(`decompress skip: ${mod.name} @ ${modPath} targets=${targets.join(',')} no matching directories`);
          this.setState({ progress: { done: 1, total: 1, text: `Skipped: ${mod.name}` } });
          continue;
        }

        this.appendLog(`  targets: ${targetPaths.length}`);
        this.debugLog(`decompress start: ${mod.name} @ ${modPath} targets=${targetPaths.join('|')}`);
        const onProgress = (done: number, total: number): void => {
          const safeTotal = Math.max(1, total);
          const safeDone = Math.max(0, Math.min(done, safeTotal));
          this.setState({ progress: { done: safeDone, total: safeTotal, text: `Decompressing: ${mod.name} (${safeDone}/${safeTotal})` } });
        };
        const result = await service.decompressModPaths(
          targetPaths,
          gameId,
          mod.id,
          mod.info,
          { measureRoot: modPath, threads: options.threads, onProgress },
        );

        this.setState((prev) => ({
          modRows: prev.modRows.map((r) => (r.id === mod.id ? { ...r, info: result.modInfo, contentTags: getContentTags(result.modInfo), hasLod: result.modInfo.lodSize > LOD_TAG_THRESHOLD } : r)),
        }));

        this.debugLog(`decompress result: code=${result.code} output=${result.output}`);

        this.setState((prev) => ({
          progress: { done: prev.progress.total || 1, total: prev.progress.total || 1, text: `Finished: ${mod.name}` },
        }));

        if (result.code === 0) {
          this.appendLog(`  [OK] ${mod.name}: decompressed`);
        } else {
          const outLines = (result.output || '').split('\n').map(s => s.trim()).filter(Boolean);
          this.appendLog(`  [ERR] ${mod.name}: exit code ${result.code}`);
          if (outLines.length) this.appendLog(`  output: ${outLines.slice(0, 5).join(' | ')}`);
        }
      } catch (err: any) {
        this.appendLog(`  [ERR] ${mod.name}: ${err?.message ?? 'Unknown error'}`);
      }
    }

    this.stopTimer();
    this.appendLog('Decompression complete');
    this.setState({ progress: { done: 0, total: 0, text: '' }, running: false });
  };

  handleSelectAll = (): void => {
    // Use the already computed filter result and a single immutable update.
    // The table itself is paged, so this does not mount thousands of checkbox
    // nodes in the same synchronous render.
    this.setState((prev) => ({ selectedIds: new Set(prev.filteredIds) }));
  };

  handleSelectNone = (): void => {
    this.setState({ selectedIds: new Set() });
  };

  handleSelectCompressed = (): void => {
    const filteredIdSet = new Set(this.state.filteredIds);
    const compressed = selectCompressed(
      this.state.modRows.filter((r) => filteredIdSet.has(r.id)),
    );
    this.setState({ selectedIds: new Set(compressed) });
  };

  handleSelectUncompressed = (): void => {
    const filteredIdSet = new Set(this.state.filteredIds);
    const uncompressed = selectUncompressed(
      this.state.modRows.filter((r) => filteredIdSet.has(r.id)),
    );
    this.setState({ selectedIds: new Set(uncompressed) });
  };

  handleSelectLod = (): void => {
    const filteredIdSet = new Set(this.state.filteredIds);
    const lod = selectLodMods(
      this.state.modRows.filter((r) => filteredIdSet.has(r.id)),
    );
    this.setState({ selectedIds: new Set(lod) });
  };

  private stagingDir(state: any, gameId: string): string | null {
    const d = state?.settings?.gameMode?.discovered?.[gameId];
    const modsPath = state?.settings?.mods?.path;
    const vortexUserData = util.getVortexPath('userData');
    const vortexBase = util.getVortexPath('base');
    const candidates = getStagingDirCandidates({
      gameId,
      discovered: d,
      modsPath,
      vortexUserData,
      vortexBase,
      appData: process.env.APPDATA,
    });
    for (const c of candidates) {
      const resolved = c ? path.resolve(c) : '(null)';
      this.debugLog(`stagingDir candidate: ${resolved} exists=${c ? fs.existsSync(c) : 'n/a'}`);
      if (c && fs.existsSync(c)) {
        try {
          if (fs.statSync(c).isDirectory()) {
            this.debugLog(`stagingDir SELECTED: ${path.resolve(c)}`);
            return path.resolve(c);
          }
        } catch { /* */ }
      }
    }
    this.debugLog(`stagingDir FAILED — discovered keys: ${Object.keys(d ?? {}).join(', ')}, mods.path=${modsPath}, vortexUserData=${vortexUserData}, vortexBase=${vortexBase}, APPDATA=${process.env.APPDATA}`);
    return null;
  }

  private async resolveModPath(mod: ModRow): Promise<string | null> {
    const state = this.props.api.getState();
    const gameId = selectors.activeGameId(state) ?? '';
    const staging = this.stagingDir(state, gameId);
    const candidates: string[] = [];

    // 0. Use API's own mod path resolution first (most reliable)
    const lookupPath = this.props.api.lookupModPath?.(gameId, mod.id);
    if (lookupPath) {
      candidates.push(lookupPath);
      this.debugLog(`resolveModPath: api.lookupModPath returned ${lookupPath}`);
    }

    const allMods = state?.persistent?.mods?.[gameId] ?? {};

    // 1. Look up mod entry in persistent.mods state
    const modEntry = allMods[mod.id];
    if (modEntry?.installationPath) {
      const p = modEntry.installationPath;
      const absPath = path.isAbsolute(p) ? p : staging ? path.join(staging, p) : p;
      candidates.push(absPath);
      this.debugLog(`resolveModPath: modEntry.installationPath=${p} full=${absPath}`);
    } else if (staging) {
      // 2. If no installationPath, guess from staging + mod name or mod id
      const guessByName = path.join(staging, mod.name);
      const guessById = path.join(staging, mod.id);
      candidates.push(guessByName, guessById);
      this.debugLog(`resolveModPath: modEntry.installationPath NOT FOUND, guessing from staging`);
    }

    // 3. If staging is null, try harder: search state for the mod entry by name
    if (!staging || candidates.length === 0) {
      this.appendLog(`  staging dir not found, trying all state mod entries for '${mod.name}'...`);
      for (const [key, m] of Object.entries(allMods) as [string, any][]) {
        if (m?.installationPath && (key === mod.id || m.name === mod.name)) {
          // Try both relative and absolute interpretations
          const ip = m.installationPath;
          const absDirect = path.isAbsolute(ip) ? ip : null;
          if (absDirect && !candidates.includes(absDirect)) candidates.push(absDirect);
          // Check data dir or vortex path as a parent
          const withUserData = path.join(util.getVortexPath('userData'), gameId, 'mods', ip);
          const withUserDataMods = path.join(util.getVortexPath('userData'), 'mods', gameId, ip);
          for (const cp of [withUserData, withUserDataMods]) {
            if (!candidates.includes(cp)) candidates.push(cp);
          }
        }
      }
    }

    // 4. Last resort: if staging exists, try mod name with common sanitizations
    if (staging) {
      const altGuesses = [
        mod.name.replace(/\s+/g, '_'),
        mod.name.replace(/[^a-zA-Z0-9_-]/g, ''),
        mod.name.toLowerCase().replace(/\s+/g, '_'),
        mod.name.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
        mod.id,
      ];
      for (const g of altGuesses) {
        const full = path.join(staging, g);
        if (!candidates.includes(full)) candidates.push(full);
      }
    }

    this.appendLog(`  resolveModPath: mod=${mod.name} staging=${staging || '(null)'} trying ${candidates.length} paths...`);
    this.debugLog(`resolveModPath: mod=${mod.name} id=${mod.id} staging=${staging} n_candidates=${candidates.length}`);

    for (const p of candidates) {
      try {
        await fs.promises.access(p);
        this.appendLog(`  path resolved: ${p}`);
        this.debugLog(`resolveModPath FOUND: ${p}`);
        return p;
      } catch {
        this.debugLog(`resolveModPath MISS: ${p}`);
      }
    }

    this.appendLog(`  [WARN] Could not find path on disk for '${mod.name}'. Check debug log.`);
    this.debugLog(`resolveModPath FAILED for ${mod.name}`);
    return null;
  }

  private debugLogFile = path.join(process.env.TEMP || '.', 'mod-compressor-debug.log');
  private _debugLogQueue: Promise<void> = Promise.resolve();
  private readonly debugLogMaxBytes = 2 * 1024 * 1024;

  private debugLog = (msg: string): void => {
    const line = `${new Date().toISOString()} ${msg}\n`;
    this._debugLogQueue = this._debugLogQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          const stat = await fs.promises.stat(this.debugLogFile);
          if (stat.size + Buffer.byteLength(line, 'utf8') > this.debugLogMaxBytes) {
            const rotated = `${this.debugLogFile}.1`;
            try { await fs.promises.unlink(rotated); } catch { /* no previous rotation */ }
            try { await fs.promises.rename(this.debugLogFile, rotated); } catch { /* best effort */ }
          }
        } catch { /* log may not exist yet */ }
        try {
          await fs.promises.appendFile(this.debugLogFile, line, 'utf8');
        } catch { /* best effort */ }
      });
  };

  appendLog = (msg: string): void => {
    this.setState((prev) => ({
      log: [msg, ...prev.log.slice(0, 499)],
    }));
  };

  toggleMod = (id: string): void => {
    this.setState((prev) => {
      const next = new Set(prev.selectedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedIds: next };
    });
  };

  handleSort = (key: string): void => {
    this.setState((prev) => ({
      sortKey: key,
      sortDir: prev.sortKey === key && prev.sortDir === 'asc' ? 'desc' : 'asc',
    }));
  };

  sortedRows(rows: ModRow[]): ModRow[] {
    const { sortKey, sortDir } = this.state;
    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'active':
          cmp = Number(a.active) - Number(b.active);
          break;
        case 'status':
          cmp = (a.info.algorithm || '').localeCompare(b.info.algorithm || '');
          break;
        case 'ratio':
          cmp = a.info.ratio - b.info.ratio;
          break;
        case 'size':
          cmp = a.info.totalSize - b.info.totalSize;
          break;
        case 'saved':
          cmp = (a.info.totalSize - a.info.diskSize) - (b.info.totalSize - b.info.diskSize);
          break;
        default:
          cmp = 0;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }

  render(): React.ReactNode {
    const {
      modRows, filteredIds, selectedIds, loading, running,
      progress, log, filter, options, elapsed, startTime, page,
    } = this.state;

    const totalMods = modRows.length;
    const compressedMods = modRows.filter((r) => r.info.totalSize > r.info.diskSize).length;
    const totalSize = modRows.reduce((s, r) => s + r.info.totalSize, 0);
    const totalDiskSize = modRows.reduce((s, r) => s + r.info.diskSize, 0);
    const totalSaved = totalSize - totalDiskSize;
    const filteredIdSet = new Set(filteredIds);
    const filteredRows = modRows.filter((r) => filteredIdSet.has(r.id));
    const sortedFilteredRows = this.sortedRows(filteredRows);
    const totalPages = Math.max(1, Math.ceil(sortedFilteredRows.length / ROWS_PER_PAGE));
    const currentPage = Math.min(page, totalPages - 1);
    const visibleRows = sortedFilteredRows.slice(currentPage * ROWS_PER_PAGE, (currentPage + 1) * ROWS_PER_PAGE);

    if (loading) {
      return <div className="mod-compressor-loading">Loading mods...</div>;
    }

    if (modRows.length === 0) {
      return (
        <div className="mod-compressor-empty">
          <h2>Mod Compressor</h2>
          <p>No Bethesda game mods found. Make sure you have a supported game selected.</p>
        </div>
      );
    }

    return (
      <div className="mod-compressor-page">
        <style>{`
          .mod-compressor-page { padding: 16px; font-size: 13px; }
          .mc-stats { color: #888; font-size: 11px; margin-bottom: 8px; }
          .mc-filters { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
          .mc-filters label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
          .mc-filters input[type="text"] { flex: 1; min-width: 200px; padding: 4px 8px; background: #333; color: #ccc; border: 1px solid #555; border-radius: 3px; }
          .mc-table-container { max-height: 450px; overflow-y: auto; border: 1px solid #333; border-radius: 4px; }
          .mc-table-container::-webkit-scrollbar { width: 8px; }
          .mc-table-container::-webkit-scrollbar-track { background: #1e1e1e; }
          .mc-table-container::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }
          .mc-table { width: 100%; border-collapse: collapse; }
          .mc-table th, .mc-table td { padding: 4px 8px; text-align: left; border-bottom: 1px solid #333; }
          .mc-table th { position: sticky; top: 0; z-index: 1; background: #2a2a2a; font-weight: 600; cursor: pointer; user-select: none; }
          .mc-table th.sorted { color: #4CAF50; }
          .mc-table th:first-child { cursor: default; }
          .mc-table tr:hover { background: #2a2a2a; }
          .mc-table .center { text-align: center; }
          .mc-table .right { text-align: right; }
          .mc-table .green { color: #4CAF50; }
          .mc-table .orange { color: #FF9800; }
          .mc-table .gray { color: #999; }
          .mc-options { margin: 12px 0; padding: 8px; background: #1e1e1e; border-radius: 4px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
          .mc-options label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
          .mc-options select { background: #333; color: #ccc; border: 1px solid #555; border-radius: 3px; padding: 4px 8px; cursor: pointer; }
          .mc-options select:hover { background: #444; }
          .mc-selected-count { color: #4CAF50; font-weight: 600; }
          .mc-toolbar { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
          .mc-toolbar button, .mc-actions button { padding: 6px 12px; cursor: pointer; border: 1px solid #555; background: #333; color: #ccc; border-radius: 3px; }
          .mc-toolbar button:hover, .mc-actions button:hover { background: #444; }
          .mc-toolbar button:disabled, .mc-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
          .mc-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
          .mc-progress { flex: 1; min-width: 200px; }
          .mc-log { background: #1a1a1a; color: #aaa; font-family: Consolas, monospace; font-size: 11px; padding: 8px; max-height: 150px; overflow-y: auto; border-radius: 4px; margin-top: 8px; white-space: pre-wrap; }
          .mc-timer { font-size: 11px; color: #aaa; margin-top: 4px; font-family: Consolas, monospace; }
          .mc-status { font-size: 11px; color: #888; margin-top: 4px; }
          .btn-primary { background: #4CAF50 !important; color: white !important; font-weight: bold; border-color: #4CAF50 !important; }
          .btn-primary:hover { background: #45a049 !important; }
          .btn-info { background: #2196F3 !important; color: white !important; font-weight: bold; border-color: #2196F3 !important; }
          .btn-info:hover { background: #1e88e5 !important; }
        `}</style>

        {/* Stats */}
        <div className="mc-stats">
          Mods: {totalMods} | Compressed: {compressedMods} | Total: {formatSize(totalSize)} | Saved: {formatSize(Math.max(0, totalSaved))}
        </div>

        {/* Filters */}
        <div className="mc-filters">
          <label>
            <input type="checkbox" checked={filter.activeOnly} onChange={(e) => {
              const checked = e.target.checked;
              this.setState((prev) => ({ filter: { ...prev.filter, activeOnly: checked } }));
            }} />
            Active only
          </label>
          <label>
            <input type="checkbox" checked={filter.compressedOnly} onChange={(e) => {
              const checked = e.target.checked;
              this.setState((prev) => ({ filter: { ...prev.filter, compressedOnly: checked } }));
            }} />
            Compressed
          </label>
          <label>
            <input type="checkbox" checked={filter.uncompressedOnly} onChange={(e) => {
              const checked = e.target.checked;
              this.setState((prev) => ({ filter: { ...prev.filter, uncompressedOnly: checked } }));
            }} />
            Uncompressed
          </label>
          <label>
            <input type="checkbox" checked={filter.lodOnly} onChange={(e) => {
              const checked = e.target.checked;
              this.setState((prev) => ({ filter: { ...prev.filter, lodOnly: checked } }));
            }} />
            Has LOD
          </label>
          <input
            type="text"
            placeholder="Search mods..."
            value={filter.searchQuery}
            onChange={(e) => {
              const val = e.target.value;
              this.setState((prev) => ({ filter: { ...prev.filter, searchQuery: val } }));
            }}
          />
        </div>

        {/* Selection toolbar */}
        <div className="mc-toolbar">
          <button onClick={this.handleSelectAll}>Select all</button>
          <button onClick={this.handleSelectNone}>Clear</button>
          <button onClick={this.handleSelectCompressed}>Select compressed</button>
          <button onClick={this.handleSelectUncompressed}>Select uncompressed</button>
          <button onClick={this.handleSelectLod} style={{ fontWeight: 'bold' }}>Select LOD mods</button>
          <button onClick={this.handleScan} disabled={running}>Scan selected</button>
          <button onClick={this.handleScanAll} disabled={running}>Scan all</button>
        </div>

        {/* Options */}
        <div className="mc-options">
          <span className="mc-selected-count">Selected: {selectedIds.size}</span>
          <span>Targets:</span>
          {TARGET_OPTIONS.map((opt) => (
            <label key={opt.key}>
              <input
                type="checkbox"
                checked={options.entireMod ? false : options.targets.includes(opt.key)}
                disabled={options.entireMod}
                onChange={(e) => {
                  const checked = e.target.checked;
                  this.setState((prev) => ({
                    options: checked
                      ? { ...prev.options, targets: [...prev.options.targets, opt.key] }
                      : { ...prev.options, targets: prev.options.targets.filter((t) => t !== opt.key) },
                  }));
                }}
              />
              {opt.label}
            </label>
          ))}
          <label style={{ marginLeft: 12 }}>
            <input
              type="checkbox"
              checked={options.entireMod}
              onChange={(e) => {
                const checked = e.target.checked;
                this.setState((prev) => ({ options: { ...prev.options, entireMod: checked } }));
              }}
            />
            Entire mod
          </label>
          <span style={{ marginLeft: 16 }}>Algorithm:</span>
          <select
            value={options.algorithm}
            onChange={(e) => {
              const val = e.target.value;
              this.setState((prev) => ({ options: { ...prev.options, algorithm: val } }));
            }}
          >
            {ALGO_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
          <span style={{ marginLeft: 16 }}>Threads:</span>
          <input
            type="number"
            min={0}
            max={16}
            value={options.threads ?? 0}
            onChange={(e) => {
              const raw = Number(e.target.value);
              const threads = Number.isFinite(raw) ? Math.max(0, Math.min(16, Math.floor(raw))) : 0;
              this.setState((prev) => ({ options: { ...prev.options, threads } }));
            }}
            style={{ width: 56, background: '#333', color: '#ccc', border: '1px solid #555', borderRadius: 3, padding: '4px 6px' }}
          />
        </div>

        {/* Mod Table */}
        <div className="mc-table-container">
        <table className="mc-table">
          <thead>
            <tr>
              <th style={{ width: 30 }}></th>
              <th onClick={() => this.handleSort('name')} className={this.state.sortKey === 'name' ? 'sorted' : ''}>
                Mod {this.state.sortKey === 'name' ? (this.state.sortDir === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th onClick={() => this.handleSort('active')} style={{ width: 50 }} className={`center${this.state.sortKey === 'active' ? ' sorted' : ''}`}>
                Active {this.state.sortKey === 'active' ? (this.state.sortDir === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th onClick={() => this.handleSort('status')} style={{ width: 130 }} className={this.state.sortKey === 'status' ? 'sorted' : ''}>
                Status {this.state.sortKey === 'status' ? (this.state.sortDir === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th onClick={() => this.handleSort('ratio')} style={{ width: 70 }} className={`center${this.state.sortKey === 'ratio' ? ' sorted' : ''}`}>
                Ratio {this.state.sortKey === 'ratio' ? (this.state.sortDir === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th onClick={() => this.handleSort('size')} style={{ width: 90 }} className={`right${this.state.sortKey === 'size' ? ' sorted' : ''}`}>
                Size {this.state.sortKey === 'size' ? (this.state.sortDir === 'asc' ? '▲' : '▼') : ''}
              </th>
              <th onClick={() => this.handleSort('saved')} style={{ width: 90 }} className={`right${this.state.sortKey === 'saved' ? ' sorted' : ''}`}>
                Saved {this.state.sortKey === 'saved' ? (this.state.sortDir === 'asc' ? '▲' : '▼') : ''}
              </th>
              
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td className="center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      onChange={() => this.toggleMod(row.id)}
                    />
                  </td>
                  <td>{row.name}</td>
                  <td className="center">{row.active ? '✓' : ''}</td>
                  <td className="center">
                    {row.info.totalSize > row.info.diskSize ? (
                      <span className="green">
                        {row.info.algorithm ? `✓ ${row.info.algorithm.toUpperCase()}` : '✓ Compressed'}
                      </span>
                    ) : row.info.scannedAt ? (
                      <span>Not compressed</span>
                    ) : (
                      <span className="gray">Not scanned</span>
                    )}
                  </td>
                  <td className="center">
                    <span className={row.info.ratio > 1.5 ? 'green' : row.info.ratio > 1.2 ? '' : ''}>
                      {formatRatio(row.info.ratio)}
                    </span>
                  </td>
                  <td className="right">{row.info.totalSize > 0 ? formatSize(row.info.totalSize) : '—'}</td>
                  <td className="right">
                    {row.info.totalSize > row.info.diskSize && row.info.diskSize > 0 ? (
                      <span className="green">-{formatSize(row.info.totalSize - row.info.diskSize)}</span>
                    ) : (
                      <span>—</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        </div>
        <div className="mc-status">
          Showing {sortedFilteredRows.length === 0 ? 0 : currentPage * ROWS_PER_PAGE + 1}
          -{Math.min((currentPage + 1) * ROWS_PER_PAGE, sortedFilteredRows.length)} of {sortedFilteredRows.length} mods
          {totalPages > 1 && <>
            {' '}<button onClick={() => this.setState({ page: Math.max(0, currentPage - 1) })} disabled={currentPage === 0}>Previous</button>
            {' '}Page {currentPage + 1} of {totalPages}
            {' '}<button onClick={() => this.setState({ page: Math.min(totalPages - 1, currentPage + 1) })} disabled={currentPage >= totalPages - 1}>Next</button>
          </>}
        </div>

        {/* Action buttons */}
        <div className="mc-actions">
          <progress
            className="mc-progress"
            value={progress.total > 0 ? progress.done : 0}
            max={progress.total || 1}
          />
          <button className="btn-primary" onClick={this.handleCompress} disabled={running}>
            Compress
          </button>
          <button className="btn-info" onClick={this.handleDecompress} disabled={running}>
            Decompress
          </button>
          <button onClick={this.handleScanAll} disabled={running}>
            Scan all
          </button>
          <div className="mc-status">{progress.text}</div>
        </div>

        {/* Log panel */}
        {log.length > 0 && (
          <>
            <div className="mc-log">
              {log.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
            {elapsed > 0 && (
              <div className="mc-timer">
                Elapsed: {formatDuration(elapsed)}
              </div>
            )}
          </>
        )}
      </div>
    );
  }
}
