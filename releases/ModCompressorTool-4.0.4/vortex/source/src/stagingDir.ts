import * as path from 'path';

export interface StagingDirInputs {
  gameId: string;
  discovered?: {
    path?: string;
    stagingPath?: string;
    modsPath?: string;
  };
  modsPath?: string;
  vortexUserData?: string;
  vortexBase?: string;
  appData?: string;
}

function unique(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of paths) {
    if (!candidate) continue;

    const key = path.normalize(candidate).toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(candidate);
    }
  }

  return result;
}

export function getStagingDirCandidates(input: StagingDirInputs): string[] {
  const { gameId, discovered: d, modsPath, vortexUserData, vortexBase, appData } = input;
  const vortexModsOnGameDrive = d?.path
    ? path.join(path.parse(d.path).root, 'Vortex Mods', gameId)
    : null;

  return unique([
    d?.stagingPath,
    d?.modsPath,
    modsPath ? path.join(modsPath, gameId) : null,
    modsPath ? path.join(modsPath, gameId, 'mods') : null,
    vortexModsOnGameDrive,
    vortexUserData ? path.join(vortexUserData, 'mods', gameId) : null,
    vortexUserData ? path.join(vortexUserData, gameId, 'mods') : null,
    vortexBase ? path.join(vortexBase, 'mods', gameId) : null,
    vortexBase ? path.join(vortexBase, gameId, 'mods') : null,
    appData ? path.join(appData, 'Vortex', 'mods', gameId) : null,
    appData ? path.join(appData, 'Vortex', gameId, 'mods') : null,
    d?.path ? path.join(d.path, 'Mods') : null,
  ]);
}

export function pickStagingDir(
  candidates: string[],
  existsDirectory: (candidate: string) => boolean,
): string | null {
  for (const candidate of candidates) {
    if (existsDirectory(candidate)) {
      return candidate;
    }
  }

  return null;
}
