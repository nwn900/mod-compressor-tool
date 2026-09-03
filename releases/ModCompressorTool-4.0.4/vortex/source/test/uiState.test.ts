import { describe, it, expect } from 'vitest';
import {
  filterMods,
  selectAll,
  selectCompressed,
  selectUncompressed,
  selectLodMods,
  modToRow,
  getSelectedTargets,
  FilterState,
  ModRow,
} from '../src/uiState';
import { ModInfo, TargetType } from '../src/types';

function makeModInfo(overrides: Partial<ModInfo> = {}): ModInfo {
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
    ...overrides,
  };
}

function makeRow(
  id: string,
  name: string,
  overrides: Partial<ModInfo> = {},
  active = true,
): ModRow {
  return modToRow(id, name, active, makeModInfo(overrides));
}

const defaultFilter: FilterState = {
  activeOnly: false,
  compressedOnly: false,
  uncompressedOnly: false,
  lodOnly: false,
  searchQuery: '',
};

describe('filterMods', () => {
  it('returns all mods with no filters', () => {
    const mods = [makeRow('1', 'Mod A'), makeRow('2', 'Mod B')];
    expect(filterMods(mods, defaultFilter)).toHaveLength(2);
  });

  it('filters by active only', () => {
    const mods = [
      makeRow('1', 'Mod A', {}, true),
      makeRow('2', 'Mod B', {}, false),
    ];
    const result = filterMods(mods, { ...defaultFilter, activeOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('filters by compressed only', () => {
    const mods = [
      makeRow('1', 'Mod A', { compressed: true }),
      makeRow('2', 'Mod B', { compressed: false }),
    ];
    const result = filterMods(mods, { ...defaultFilter, compressedOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('filters by uncompressed only', () => {
    const mods = [
      makeRow('1', 'Mod A', { compressed: true }),
      makeRow('2', 'Mod B', { compressed: false }),
    ];
    const result = filterMods(mods, { ...defaultFilter, uncompressedOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('filters by LOD only', () => {
    const mods = [
      makeRow('1', 'Mod A', { lodSize: 500 * 1024 }),
      makeRow('2', 'Mod B', { lodSize: 0 }),
    ];
    const result = filterMods(mods, { ...defaultFilter, lodOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('filters by search query', () => {
    const mods = [
      makeRow('1', 'Skyrim Textures'),
      makeRow('2', 'Fallout Meshes'),
    ];
    const result = filterMods(mods, { ...defaultFilter, searchQuery: 'skyrim' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('combines multiple filters', () => {
    const mods = [
      makeRow('1', 'Skyrim Tex', { compressed: true, lodSize: 500 * 1024 }, true),
      makeRow('2', 'Skyrim Mesh', { compressed: false, lodSize: 0 }, true),
    ];
    const result = filterMods(mods, {
      activeOnly: true,
      compressedOnly: true,
      uncompressedOnly: false,
      lodOnly: true,
      searchQuery: 'skyrim',
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });
});

describe('selectAll', () => {
  it('returns all mod IDs', () => {
    const mods = [makeRow('a', 'A'), makeRow('b', 'B')];
    expect(selectAll(mods)).toEqual(['a', 'b']);
  });
});

describe('selectCompressed', () => {
  it('returns compressed mod IDs', () => {
    const mods = [
      makeRow('a', 'A', { totalSize: 100, diskSize: 50 }),
      makeRow('b', 'B', { totalSize: 50, diskSize: 50 }),
    ];
    expect(selectCompressed(mods)).toEqual(['a']);
  });
});

describe('selectUncompressed', () => {
  it('returns uncompressed mod IDs', () => {
    const mods = [
      makeRow('a', 'A', { totalSize: 100, diskSize: 50 }),
      makeRow('b', 'B', { totalSize: 50, diskSize: 50 }),
    ];
    expect(selectUncompressed(mods)).toEqual(['b']);
  });
});

describe('selectLodMods', () => {
  it('returns mods with LOD content', () => {
    const mods = [
      makeRow('a', 'A', { lodSize: 500 * 1024 }),
      makeRow('b', 'B', { lodSize: 0 }),
    ];
    expect(selectLodMods(mods)).toEqual(['a']);
  });
});

describe('modToRow', () => {
  it('sets hasLod when lodSize exceeds threshold', () => {
    const row = modToRow('1', 'Test Mod', true, makeModInfo({ lodSize: 500 * 1024 }));
    expect(row.hasLod).toBe(true);
    expect(row.contentTags).toContain('LOD');
  });
});

describe('getSelectedTargets', () => {
  it('returns ALL when entireMod is true', () => {
    const targets = getSelectedTargets({
      targets: [TargetType.TEXTURES],
      algorithm: 'xpress8k',
      entireMod: true,
    });
    expect(targets).toEqual([TargetType.ALL]);
  });

  it('returns specific targets when entireMod is false', () => {
    const targets = getSelectedTargets({
      targets: [TargetType.TEXTURES, TargetType.MESHES],
      algorithm: 'xpress8k',
      entireMod: false,
    });
    expect(targets).toEqual([TargetType.TEXTURES, TargetType.MESHES]);
  });
});
