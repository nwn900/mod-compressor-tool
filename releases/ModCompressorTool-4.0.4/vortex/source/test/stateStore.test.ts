import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { StateStore } from '../src/stateStore';
import { ModInfo, modInfoFromDict } from '../src/types';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stateStore-test-'));
}

function makeSampleModInfo(overrides: Partial<ModInfo> = {}): ModInfo {
  return modInfoFromDict({
    fileCount: 10,
    totalSize: 1000,
    diskSize: 800,
    ratio: 0.8,
    compressed: true,
    algorithm: 'xpress8k',
    compressedAt: '2025-01-01T00:00:00Z',
    scannedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  });
}

describe('StateStore', () => {
  let tmpDir: string;
  let store: StateStore;

  beforeEach(() => {
    tmpDir = makeTempDir();
    store = new StateStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('returns empty state when file does not exist', async () => {
      const state = await store.load('nonexistent-game');
      expect(state).toEqual({});
    });

    it('returns empty state when JSON is corrupted', async () => {
      const stateDir = path.join(tmpDir, 'mod-compressor');
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, 'corrupt.json'), '{ invalid json }', 'utf-8');

      const state = await store.load('corrupt');
      expect(state).toEqual({});
    });
  });

  describe('save', () => {
    it('creates the directory structure and writes atomically', async () => {
      const gameId = 'test-game';
      const data: Record<string, ModInfo> = {
        mod1: makeSampleModInfo({ fileCount: 5 }),
      };

      const result = await store.save(gameId, data);
      expect(result).toBe(true);

      // Verify .tmp file was cleaned up (not left behind)
      const stateDir = path.join(tmpDir, 'mod-compressor');
      const tmpFiles = fs.readdirSync(stateDir).filter(f => f.endsWith('.tmp'));
      expect(tmpFiles).toHaveLength(0);

      // Verify final file exists and contains correct data
      const finalPath = path.join(stateDir, `${gameId}.json`);
      expect(fs.existsSync(finalPath)).toBe(true);

      const contents = JSON.parse(fs.readFileSync(finalPath, 'utf-8'));
      expect(contents).toEqual({ mod1: expect.objectContaining({ fileCount: 5 }) });
    });

    it('returns false on write failure', async () => {
      // Point to a non-writable location (root drive is not writable on Windows for regular users)
      const badStore = new StateStore('Z:\\nonexistent');
      const data: Record<string, ModInfo> = { mod1: makeSampleModInfo() };
      const result = await badStore.save('game', data);
      expect(result).toBe(false);
    });
  });

  describe('round-trip', () => {
    it('save then load returns the same data', async () => {
      const gameId = 'skyrim';
      const data: Record<string, ModInfo> = {
        modA: makeSampleModInfo({ fileCount: 100, totalSize: 50000, algorithm: 'lzx' }),
        modB: makeSampleModInfo({ fileCount: 3, totalSize: 200, compressed: false }),
      };

      const saveResult = await store.save(gameId, data);
      expect(saveResult).toBe(true);

      const loaded = await store.load(gameId);
      expect(loaded).toEqual(data);
    });
  });

  describe('getMod / setMod / removeMod', () => {
    it('getMod returns undefined for unknown mod', () => {
      const result = store.getMod('game1', 'unknown-mod');
      expect(result).toBeUndefined();
    });

    it('setMod stores a mod in memory then getMod retrieves it', () => {
      const mod = makeSampleModInfo({ fileCount: 42 });
      store.setMod('game1', 'modX', mod);
      const result = store.getMod('game1', 'modX');
      expect(result).toEqual(mod);
    });

    it('getMod scoped by gameId', () => {
      store.setMod('game1', 'shared', makeSampleModInfo({ fileCount: 1 }));
      store.setMod('game2', 'shared', makeSampleModInfo({ fileCount: 2 }));

      expect(store.getMod('game1', 'shared')?.fileCount).toBe(1);
      expect(store.getMod('game2', 'shared')?.fileCount).toBe(2);
    });

    it('removeMod deletes a mod from in-memory state', () => {
      store.setMod('game1', 'modA', makeSampleModInfo());
      store.removeMod('game1', 'modA');
      expect(store.getMod('game1', 'modA')).toBeUndefined();
    });

    it('removeMod does not affect other games', () => {
      store.setMod('game1', 'modA', makeSampleModInfo());
      store.setMod('game2', 'modB', makeSampleModInfo());
      store.removeMod('game1', 'modA');

      expect(store.getMod('game2', 'modB')).toBeDefined();
    });

    it('setMod/getMod does not persist until save() is called', async () => {
      store.setMod('game1', 'memOnly', makeSampleModInfo({ fileCount: 999 }));

      // Load without saving first — should be empty
      const loaded = await store.load('game1');
      expect(loaded).not.toHaveProperty('memOnly');
    });
  });
});
