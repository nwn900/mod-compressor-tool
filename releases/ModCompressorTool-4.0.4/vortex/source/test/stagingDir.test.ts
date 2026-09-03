import { describe, expect, it } from 'vitest';
import { getStagingDirCandidates, pickStagingDir } from '../src/stagingDir';

describe('staging directory resolution', () => {
  it('prefers the configured mods path over the appdata game folder', () => {
    const candidates = getStagingDirCandidates({
      gameId: 'fallout4',
      discovered: { path: 'E:\\SteamLibrary\\steamapps\\common\\Fallout 4\\' },
      modsPath: 'E:\\Vortex Mods',
      vortexUserData: 'C:\\Users\\micha\\AppData\\Roaming\\Vortex',
      vortexBase: 'C:\\Program Files\\Black Tree Gaming Ltd\\Vortex',
      appData: 'C:\\Users\\micha\\AppData\\Roaming',
    });

    expect(candidates).toContain('E:\\Vortex Mods\\fallout4');
    expect(candidates).not.toContain('C:\\Users\\micha\\AppData\\Roaming\\Vortex\\fallout4');

    const existing = new Set([
      'C:\\Users\\micha\\AppData\\Roaming\\Vortex\\fallout4',
      'E:\\Vortex Mods\\fallout4',
    ]);
    const picked = pickStagingDir(candidates, (candidate) => existing.has(candidate));

    expect(picked).toBe('E:\\Vortex Mods\\fallout4');
  });

  it('tries the game-drive Vortex Mods folder before appdata fallbacks', () => {
    const candidates = getStagingDirCandidates({
      gameId: 'fallout4',
      discovered: { path: 'E:\\SteamLibrary\\steamapps\\common\\Fallout 4\\' },
      vortexUserData: 'C:\\Users\\micha\\AppData\\Roaming\\Vortex',
      appData: 'C:\\Users\\micha\\AppData\\Roaming',
    });

    expect(candidates.indexOf('E:\\Vortex Mods\\fallout4')).toBeLessThan(
      candidates.indexOf('C:\\Users\\micha\\AppData\\Roaming\\Vortex\\fallout4\\mods'),
    );
  });
});
