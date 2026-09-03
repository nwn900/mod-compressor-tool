import { ModInfo } from './types';
import { ModRow, modToRow } from './uiState';

export interface BuildModRowsInput {
  persistentMods: Record<string, any>;
  profileMods: Record<string, any>;
  savedInfo: Record<string, ModInfo>;
}

export interface ModListSignatureInput {
  gameId: string;
  persistentMods: Record<string, any>;
  profileMods: Record<string, any>;
}

export function createEmptyModInfo(): ModInfo {
  return {
    fileCount: 0,
    totalSize: 0,
    diskSize: 0,
    ratio: 1.0,
    compressed: false,
    algorithm: '',
    compressedAt: '',
    scannedAt: '',
    skippedFiles: 0,
    textureSize: 0,
    meshSize: 0,
    soundSize: 0,
    lodSize: 0,
    animationSize: 0,
    otherSize: 0,
    compressedByAttr: 0,
    compressedBySize: 0,
    compressedByWof: 0,
  };
}

export function buildModRows(input: BuildModRowsInput): ModRow[] {
  const rows: ModRow[] = [];

  for (const [modId, modEntry] of Object.entries(input.persistentMods ?? {})) {
    const entry = modEntry as any;
    const modName = entry?.name ?? modId;
    const instPath = entry?.installationPath;

    if (!instPath) {
      continue;
    }

    const modState = input.profileMods?.[modId] ?? {};
    const enabled = (modState as any)?.enabled ?? true;
    const saved = input.savedInfo?.[modId];
    const info = saved && typeof saved === 'object' && 'compressed' in saved
      ? saved
      : createEmptyModInfo();

    rows.push(modToRow(modId, modName, enabled, info));
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function createModListSignature(input: ModListSignatureInput): string {
  const parts = Object.entries(input.persistentMods ?? {})
    .map(([modId, modEntry]) => {
      const entry = modEntry as any;
      const modState = input.profileMods?.[modId] ?? {};
      const enabled = (modState as any)?.enabled ?? true;
      return [
        modId,
        entry?.name ?? '',
        entry?.installationPath ?? '',
        enabled ? '1' : '0',
      ].join('\u001f');
    })
    .sort();

  return [input.gameId, ...parts].join('\u001e');
}

export function pruneSelectedIds(selectedIds: Set<string>, rows: ModRow[]): Set<string> {
  const rowIds = new Set(rows.map((row) => row.id));
  return new Set([...selectedIds].filter((modId) => rowIds.has(modId)));
}
