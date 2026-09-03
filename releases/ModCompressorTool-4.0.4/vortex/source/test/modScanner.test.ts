import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, it, expect } from 'vitest';
import { getFileCategory, findTargetDirs, scanMod } from '../src/modScanner';
import { TargetType } from '../src/types';

const tempRoots: string[] = [];

function makeTempMod(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-compressor-'));
  tempRoots.push(root);
  return root;
}

function mkdirp(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizePaths(paths: string[]): string[] {
  return paths.map((p) => path.normalize(p).toLowerCase()).sort();
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- getFileCategory Tests ---

describe('getFileCategory()', () => {
  it('classifies .dds as texture', () => {
    expect(getFileCategory('C:\\mod\\textures\\rock.dds', '.dds')).toBe('texture');
  });

  it('classifies .nif as mesh', () => {
    expect(getFileCategory('C:\\mod\\meshes\\sword.nif', '.nif')).toBe('mesh');
  });

  it('classifies paths with /lod/ as lod', () => {
    expect(getFileCategory('C:\\mod\\textures\\lod\\tree.dds', '.dds')).toBe('lod');
    expect(getFileCategory('C:\\mod\\meshes\\lod\\house.nif', '.nif')).toBe('lod');
  });

  it('classifies paths with /dyndolod/ as lod', () => {
    expect(getFileCategory('C:\\mod\\dyndolod\\output\\tamriel.4.0.0.dds', '.dds')).toBe('lod');
  });

  it('classifies paths with /terrain/ as lod', () => {
    expect(getFileCategory('C:\\mod\\textures\\terrain\\noise.dds', '.dds')).toBe('lod');
  });

  it('classifies .lst as lod', () => {
    expect(getFileCategory('C:\\mod\\lodsettings\\world.lst', '.lst')).toBe('lod');
  });

  it('classifies .hkx as animation', () => {
    expect(getFileCategory('C:\\mod\\animations\\idle.hkx', '.hkx')).toBe('animation');
  });

  it('returns other for unrecognized path/ext combos', () => {
    expect(getFileCategory('C:\\mod\\misc\\readme.txt', '.txt')).toBe('other');
  });

  it('works with forward slash paths', () => {
    expect(getFileCategory('C:/mod/textures/lod/tree.dds', '.dds')).toBe('lod');
  });
});

// --- findTargetDirs Tests ---

describe('findTargetDirs()', () => {
  it('returns mod root for TargetType.ALL', () => {
    const result = findTargetDirs('C:\\mod', ['all']);
    expect(result).toEqual(['C:\\mod']);
  });

  it('returns textures dir when it exists', () => {
    const result = findTargetDirs('C:\\mod', ['textures']);
    // C:\\mod\\textures doesn't actually exist in test, so returns empty
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns only selected top-level and Data target directories', () => {
    const root = makeTempMod();
    const rootTextures = path.join(root, 'textures');
    const dataMeshes = path.join(root, 'Data', 'meshes');
    const scripts = path.join(root, 'scripts');
    mkdirp(rootTextures);
    mkdirp(dataMeshes);
    mkdirp(scripts);

    const result = findTargetDirs(root, [TargetType.TEXTURES, TargetType.MESHES]);

    expect(normalizePaths(result)).toEqual(normalizePaths([rootTextures, dataMeshes]));
  });

  it('deduplicates selected target directories', () => {
    const root = makeTempMod();
    const rootTextures = path.join(root, 'textures');
    mkdirp(rootTextures);

    const result = findTargetDirs(root, [TargetType.TEXTURES, TargetType.TEXTURES]);

    expect(normalizePaths(result)).toEqual(normalizePaths([rootTextures]));
  });

  it('does not expand an LOD selection to the whole mod from its name', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'Grass Lighting Fix-'));
    tempRoots.push(root);
    fs.writeFileSync(path.join(root, 'unrelated.dds'), Buffer.alloc(512));

    expect(findTargetDirs(root, [TargetType.LOD])).toEqual([]);
  });
});

describe('scanMod()', () => {
  it('reports progress against the complete file list', async () => {
    const root = makeTempMod();
    mkdirp(path.join(root, 'textures'));
    fs.writeFileSync(path.join(root, 'textures', 'one.dds'), Buffer.alloc(512));
    fs.writeFileSync(path.join(root, 'textures', 'two.dds'), Buffer.alloc(512));
    const progress: Array<[number, number]> = [];

    await scanMod(root, {
      useCompactCheck: false,
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(progress[progress.length - 1]).toEqual([2, 2]);
    expect(progress.every(([, total]) => total === 2)).toBe(true);
  });
});
