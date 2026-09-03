import { ModInfo, TargetType, TARGET_NAMES } from './types';
import { getContentTags } from './format';

export interface ModRow {
  id: string;
  name: string;
  active: boolean;
  info: ModInfo;
  contentTags: string[];
  hasLod: boolean;
}

export interface FilterState {
  activeOnly: boolean;
  compressedOnly: boolean;
  uncompressedOnly: boolean;
  lodOnly: boolean;
  searchQuery: string;
}

export interface UiOptions {
  targets: TargetType[];
  algorithm: string;
  entireMod: boolean;
  threads?: number;
}

export const LOD_TAG_THRESHOLD = 256 * 1024;

export function filterMods(
  mods: ModRow[],
  filter: FilterState,
): ModRow[] {
  return mods.filter((mod) => {
    if (filter.activeOnly && !mod.active) {
      return false;
    }
    if (filter.compressedOnly && !mod.info.compressed) {
      return false;
    }
    if (filter.uncompressedOnly && mod.info.compressed) {
      return false;
    }
    if (filter.lodOnly && !mod.hasLod) {
      return false;
    }
    if (
      filter.searchQuery &&
      !mod.name.toLowerCase().includes(filter.searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });
}

export function selectAll(mods: ModRow[]): string[] {
  return mods.map((m) => m.id);
}

export function selectCompressed(mods: ModRow[]): string[] {
  return mods.filter((m) => m.info.totalSize > m.info.diskSize).map((m) => m.id);
}

export function selectUncompressed(mods: ModRow[]): string[] {
  return mods.filter((m) => m.info.totalSize <= m.info.diskSize).map((m) => m.id);
}

export function selectLodMods(mods: ModRow[]): string[] {
  return mods.filter((m) => m.hasLod).map((m) => m.id);
}

export function modToRow(
  id: string,
  name: string,
  active: boolean,
  info: ModInfo,
): ModRow {
  const tags = getContentTags(info);
  return {
    id,
    name,
    active,
    info,
    contentTags: tags,
    hasLod: tags.includes('LOD'),
  };
}

export function getSelectedTargets(options: UiOptions): TargetType[] {
  if (options.entireMod) {
    return [TargetType.ALL];
  }
  return options.targets;
}
