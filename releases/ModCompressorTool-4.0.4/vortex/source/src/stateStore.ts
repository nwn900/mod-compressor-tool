import * as path from 'path';
import * as fs from 'fs';
import { ModInfo, modInfoFromDict, modInfoToDict } from './types';

const STATE_SUBDIR = 'mod-compressor';

export class StateStore {
  private state: Map<string, Map<string, ModInfo>> = new Map();
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  private stateDir(): string {
    return path.join(this.basePath, STATE_SUBDIR);
  }

  private statePath(gameId: string): string {
    return path.join(this.stateDir(), `${gameId}.json`);
  }

  private tmpPath(gameId: string): string {
    return path.join(this.stateDir(), `${gameId}.json.tmp`);
  }

  async load(gameId: string): Promise<Record<string, ModInfo>> {
    const filePath = this.statePath(gameId);
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const parsed: Record<string, Partial<ModInfo>> = JSON.parse(raw);

      const result: Record<string, ModInfo> = {};
      const gameMap = new Map<string, ModInfo>();

      for (const [modId, dict] of Object.entries(parsed)) {
        const info = modInfoFromDict(dict);
        result[modId] = info;
        gameMap.set(modId, info);
      }

      this.state.set(gameId, gameMap);
      return result;
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        return {};
      }
      if (isNodeError(err) && err.code === 'ENOENT') {
        return {};
      }
      return {};
    }
  }

  async save(gameId: string, data: Record<string, ModInfo>): Promise<boolean> {
    const dir = this.stateDir();
    const tmp = this.tmpPath(gameId);
    const finalPath = this.statePath(gameId);

    try {
      await fs.promises.mkdir(dir, { recursive: true });

      const serialized: Record<string, Record<string, unknown>> = {};
      for (const [modId, info] of Object.entries(data)) {
        serialized[modId] = modInfoToDict(info);
      }

      await fs.promises.writeFile(tmp, JSON.stringify(serialized, null, 2), 'utf-8');
      await fs.promises.rename(tmp, finalPath);

      // Update in-memory state
      const gameMap = new Map<string, ModInfo>();
      for (const [modId, info] of Object.entries(data)) {
        gameMap.set(modId, info);
      }
      this.state.set(gameId, gameMap);

      return true;
    } catch {
      // Clean up orphaned .tmp file if rename failed
      try {
        await fs.promises.unlink(tmp);
      } catch {
        // ignore cleanup errors
      }
      return false;
    }
  }

  getMod(gameId: string, modId: string): ModInfo | undefined {
    return this.state.get(gameId)?.get(modId);
  }

  setMod(gameId: string, modId: string, info: ModInfo): void {
    let gameMap = this.state.get(gameId);
    if (!gameMap) {
      gameMap = new Map();
      this.state.set(gameId, gameMap);
    }
    gameMap.set(modId, info);
  }

  removeMod(gameId: string, modId: string): void {
    this.state.get(gameId)?.delete(modId);
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
