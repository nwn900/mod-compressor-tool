import { describe, it, expect } from 'vitest';
import { matchesTargetPath, filterFilePathsByTarget } from '../src/targetUtils';

describe('matchesTargetPath()', () => {
  it('matches paths under textures dir', () => {
    expect(matchesTargetPath('textures/rock.dds', ['textures'])).toBe(true);
    expect(matchesTargetPath('textures/subdir/file.dds', ['textures'])).toBe(true);
  });

  it('matches paths under meshes dir', () => {
    expect(matchesTargetPath('meshes/sword.nif', ['meshes'])).toBe(true);
    expect(matchesTargetPath('meshes/weapons/sword.nif', ['meshes'])).toBe(true);
  });

  it('rejects paths outside target dirs', () => {
    expect(matchesTargetPath('textures/rock.dds', ['meshes'])).toBe(false);
    expect(matchesTargetPath('misc/file.txt', ['textures'])).toBe(false);
  });

  it('returns true for TargetType.ALL', () => {
    expect(matchesTargetPath('any/path/file.dds', ['all'])).toBe(true);
  });

  it('matches LOD nested paths', () => {
    expect(matchesTargetPath('textures/terrain/noise.dds', ['lod'])).toBe(true);
    expect(matchesTargetPath('meshes/terrain/world.nif', ['lod'])).toBe(true);
  });

  it('matches dyndolod output paths', () => {
    expect(matchesTargetPath('dyndolod/output/tamriel.4.0.0.dds', ['lod'])).toBe(true);
  });

  it('handles case-insensitive matching', () => {
    expect(matchesTargetPath('Textures/rock.dds', ['textures'])).toBe(true);
    expect(matchesTargetPath('MESHES/SWORD.NIF', ['meshes'])).toBe(true);
  });

  it('returns false for empty targets', () => {
    expect(matchesTargetPath('textures/rock.dds', [])).toBe(false);
  });
});

describe('filterFilePathsByTarget()', () => {
  it('filters to only matching file paths', () => {
    const files = [
      'C:\\mod\\textures\\rock.dds',
      'C:\\mod\\meshes\\sword.nif',
      'C:\\mod\\misc\\readme.txt',
    ];

    const result = filterFilePathsByTarget(files, 'C:\\mod', ['textures']);
    expect(result).toEqual(['C:\\mod\\textures\\rock.dds']);
  });

  it('returns all files for TargetType.ALL', () => {
    const files = [
      'C:\\mod\\textures\\rock.dds',
      'C:\\mod\\meshes\\sword.nif',
    ];

    const result = filterFilePathsByTarget(files, 'C:\\mod', ['all']);
    expect(result).toHaveLength(2);
  });

  it('matches multiple target types', () => {
    const files = [
      'C:\\mod\\textures\\rock.dds',
      'C:\\mod\\meshes\\sword.nif',
      'C:\\mod\\sound\\music.mp3',
    ];

    const result = filterFilePathsByTarget(files, 'C:\\mod', ['textures', 'meshes']);
    expect(result).toEqual([
      'C:\\mod\\textures\\rock.dds',
      'C:\\mod\\meshes\\sword.nif',
    ]);
  });

  it('handles files outside base root by using basename', () => {
    const files = ['D:\\other\\path\\textures\\rock.dds'];
    const result = filterFilePathsByTarget(files, 'C:\\mod', ['textures']);
    // basename of the path contains no texture dir indicator from the rel path
    expect(result).toEqual([]);
  });

  it('deduplicates matching files', () => {
    const files = [
      'C:\\mod\\textures\\rock.dds',
      'C:\\mod\\textures\\rock.dds',
    ];

    const result = filterFilePathsByTarget(files, 'C:\\mod', ['textures']);
    expect(result).toEqual(['C:\\mod\\textures\\rock.dds']);
  });
});
