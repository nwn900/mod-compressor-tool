import { describe, expect, it } from 'vitest';
import {
  buildModRows,
  createEmptyModInfo,
  createModListSignature,
  pruneSelectedIds,
} from '../src/modList';

describe('mod list state helpers', () => {
  it('builds rows for installed mods and preserves saved compression info', () => {
    const saved = createEmptyModInfo();
    saved.fileCount = 42;
    saved.compressed = true;

    const rows = buildModRows({
      persistentMods: {
        modA: { name: 'Alpha', installationPath: 'Alpha-1-0' },
        modB: { name: 'Beta' },
      },
      profileMods: {
        modA: { enabled: false },
      },
      savedInfo: { modA: saved },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'modA',
      name: 'Alpha',
      active: false,
      info: expect.objectContaining({ fileCount: 42, compressed: true }),
    });
  });

  it('changes signature when mods are installed, removed, renamed, or toggled', () => {
    const base = createModListSignature({
      gameId: 'fallout4',
      persistentMods: {
        modA: { name: 'Alpha', installationPath: 'Alpha-1-0' },
      },
      profileMods: {
        modA: { enabled: true },
      },
    });

    const installed = createModListSignature({
      gameId: 'fallout4',
      persistentMods: {
        modA: { name: 'Alpha', installationPath: 'Alpha-1-0' },
        modB: { name: 'Beta', installationPath: 'Beta-1-0' },
      },
      profileMods: { modA: { enabled: true }, modB: { enabled: true } },
    });
    const removed = createModListSignature({
      gameId: 'fallout4',
      persistentMods: {},
      profileMods: {},
    });
    const renamed = createModListSignature({
      gameId: 'fallout4',
      persistentMods: {
        modA: { name: 'Alpha Renamed', installationPath: 'Alpha-1-0' },
      },
      profileMods: { modA: { enabled: true } },
    });
    const toggled = createModListSignature({
      gameId: 'fallout4',
      persistentMods: {
        modA: { name: 'Alpha', installationPath: 'Alpha-1-0' },
      },
      profileMods: { modA: { enabled: false } },
    });

    expect(installed).not.toBe(base);
    expect(removed).not.toBe(base);
    expect(renamed).not.toBe(base);
    expect(toggled).not.toBe(base);
  });

  it('prunes selected mod ids that no longer exist in the row list', () => {
    const rows = buildModRows({
      persistentMods: {
        modA: { name: 'Alpha', installationPath: 'Alpha-1-0' },
      },
      profileMods: {},
      savedInfo: {},
    });

    expect([...pruneSelectedIds(new Set(['modA', 'modB']), rows)]).toEqual(['modA']);
  });
});
