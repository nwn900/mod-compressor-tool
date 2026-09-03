import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Module imports
import { CompressionService } from '../src/compressionService';
import { CompactAdapter } from '../src/windowsCompression';
import { StateStore } from '../src/stateStore';
import { scanMod } from '../src/modScanner';
import { verifyDecompression } from '../src/verification';
import { matchesTargetPath, filterFilePathsByTarget } from '../src/targetUtils';
import { formatSize, formatRatio, nowISO } from '../src/format';
import { CompressionAlgorithm, TargetType } from '../src/types';

describe('integration: full compress flow (mocked compact.exe)', () => {
  let tmpDir: string;
  let store: StateStore;
  let adapter: CompactAdapter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-comp-test-'));
    store = new StateStore(tmpDir);
    const mockRun = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    adapter = new CompactAdapter({ run: mockRun } as any);
  });

  it('compression service: compress then decompress then verify', async () => {
    const service = new CompressionService(adapter, store);
    const gameId = 'skyrimse';
    const modId = 'test-mod-1';
    const modPath = path.join(tmpDir, 'mods', 'test-mod');

    // Create minimal mod structure (files must exceed MIN_FILE_SIZE=256)
    fs.mkdirSync(path.join(modPath, 'textures', 'actors'), { recursive: true });
    fs.mkdirSync(path.join(modPath, 'meshes'), { recursive: true });
    fs.writeFileSync(path.join(modPath, 'textures', 'actors', 'body.dds'), 'x'.repeat(500));
    fs.writeFileSync(path.join(modPath, 'textures', 'actors', 'face.dds'), 'y'.repeat(500));
    fs.writeFileSync(path.join(modPath, 'meshes', 'actor.nif'), 'z'.repeat(500));
    fs.writeFileSync(path.join(modPath, 'plugin.esp'), 'w'.repeat(500));

    // 1. Scan the mod
    const scanResult = await scanMod(modPath);
    expect(scanResult.info.fileCount).toBeGreaterThan(0);
    expect(scanResult.info.compressed).toBe(false);

    // 2. Compress the mod
    // The mocked compact runner cannot change NTFS metadata, so provide the
    // query results that a real compact.exe invocation would produce.
    adapter.query = vi.fn()
      .mockResolvedValueOnce({ compressed: true, ratio: 2.0 })
      .mockResolvedValueOnce({ compressed: false, ratio: 1.0 });
    const compressResult = await service.compressMod(
      modPath,
      CompressionAlgorithm.XPRESS8K,
      { isDir: true, modId },
      gameId,
    );
    expect(compressResult.code).toBe(0);

    // 3. Store should have mod info
    const storedInfo = service.getModInfo(gameId, modId);
    expect(storedInfo).toBeDefined();
    expect(storedInfo!.compressed).toBe(true);

    // 4. Decompress the mod
    const decompressResult = await service.decompressMod(modPath, gameId, modId);
    expect(decompressResult.code).toBe(0);
    expect(decompressResult.steps).toHaveLength(5);

    // 5. Verify decompression
    const verifyResult = await verifyDecompression(
      modPath,
      { compactAdapter: adapter },
      [],
    );
    expect(verifyResult).toBeDefined();
  });
});

describe('integration: targetUtils with mod scanner', () => {
  let tmpDir: string;
  const paths: string[] = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-comp-targ-'));
    // Create a mod structure
    const base = path.join(tmpDir, 'mod');
    fs.mkdirSync(path.join(base, 'textures'), { recursive: true });
    fs.mkdirSync(path.join(base, 'meshes'), { recursive: true });
    fs.mkdirSync(path.join(base, 'sound'), { recursive: true });
    fs.mkdirSync(path.join(base, 'DynDOLOD'), { recursive: true });

    const files = [
      'textures/landscape.dds',
      'meshes/rock.nif',
      'sound/ambient.wav',
      'DynDOLOD/DynDOLOD.esp',
      'readme.txt',
    ];
    for (const f of files) {
      const fp = path.join(base, f);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, 'content');
      paths.push(fp);
    }
  });

  it('filterFilePathsByTarget matches only textures target', () => {
    const baseRoot = path.join(tmpDir, 'mod');
    const filtered = filterFilePathsByTarget(paths, baseRoot, ['textures']);
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    for (const fp of filtered) {
      expect(fp.toLowerCase()).toContain('textures');
    }
  });

  it('filterFilePathsByTarget with all target returns all paths', () => {
    const baseRoot = path.join(tmpDir, 'mod');
    const filtered = filterFilePathsByTarget(paths, baseRoot, ['all']);
    expect(filtered.length).toBeGreaterThanOrEqual(paths.length);
  });

  it('matchesTargetPath correctly identifies LOD paths', () => {
    expect(matchesTargetPath('DynDOLOD/DynDOLOD.esp', ['lod'])).toBe(true);
    expect(matchesTargetPath('textures/landscape.dds', ['lod'])).toBe(false);
  });
});

describe('integration: format utilities', () => {
  it('nowISO produces valid ISO string', () => {
    const ts = nowISO();
    expect(() => new Date(ts)).not.toThrow();
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('formatSize and formatRatio produce expected outputs', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1_048_576)).toMatch(/1\.00\s+MB/);
    expect(formatRatio(1.5)).toBe('1.50x');
  });
});
