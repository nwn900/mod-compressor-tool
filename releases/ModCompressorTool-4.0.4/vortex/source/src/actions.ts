import { IExtensionApi, IExtensionContext, INotification, selectors } from 'vortex-api';
import { CompressionService } from './compressionService';
import { CompressionAlgorithm, DEFAULT_ALGORITHM } from './types';
import { nowISO } from './format';
import { BETHESDA_GAME_IDS } from './constants';

export interface ProgressInfo {
  modId: string;
  modName: string;
  phase: 'scan' | 'compress' | 'decompress' | 'done' | 'error';
  done: number;
  total: number;
}

/**
 * Send a notification about compression status.
 * Keeps a single active notification and updates it
 * to avoid spamming the UI.
 */
let activeNotificationId: string | undefined;

function isSupportedGame(context: IExtensionContext): boolean {
  try {
    const gameId = selectors.activeGameId(context.api.getState()) ?? '';
    return BETHESDA_GAME_IDS.has(gameId.toLowerCase());
  } catch {
    return false;
  }
}

export function sendProgressNotification(
  api: IExtensionApi,
  info: ProgressInfo,
): void {
  const t = (v: string) => v; // placeholder translator

  let message = `[${info.done}/${info.total}] ${info.modName}`;
  let type: INotification['type'] = 'info';
  let title = '';

  switch (info.phase) {
    case 'scan':
      title = t('Scanning mods...');
      break;
    case 'compress':
      title = t('Compressing...');
      break;
    case 'decompress':
      title = t('Decompressing...');
      break;
    case 'done':
      title = t('Compression complete');
      type = 'success';
      message = `${info.modName} — ${info.done} of ${info.total} done`;
      break;
    case 'error':
      title = t('Compression error');
      type = 'error';
      break;
  }

  api.sendNotification({ type, message, title });

  // Could track activeNotificationId for V2 with dismissNotification
}

/**
 * Register compress mod toolbar action.
 */
export function registerCompressAction(
  context: IExtensionContext,
  getService: () => CompressionService | undefined,
): void {
  context.registerAction(
    'mods-actionbar',
    100, // group order
    'compress', // icon name
    'Compress Mods',
    async (modIds: string[]) => {
      const api: IExtensionApi = context.api;
      const service = getService();
      if (!service) {
        api.sendNotification({
          type: 'error',
          message: 'Compression service not initialized',
          title: 'Compression Error',
        });
        return;
      }

      if (!service.isWindows()) {
        api.sendNotification({
          type: 'error',
          message: service.getPlatformError(),
          title: 'Compression Error',
        });
        return;
      }

      try {
        const state = api.getState();
        const gameId = state?.settings?.gameMode?.id ?? '';

        if (!gameId) {
          api.sendNotification({
            type: 'error',
            message: 'No game selected in Vortex',
            title: 'Compression Error',
          });
          return;
        }

        // Resolve mod paths from IDs and compress each
        for (let i = 0; i < modIds.length; i++) {
          const modId = modIds[i];
          const modName = api.lookupModName?.(gameId, modId) ?? modId;
          const modPath = api.lookupModPath?.(gameId, modId);

          sendProgressNotification(api, {
            modId,
            modName,
            phase: 'compress',
            done: i,
            total: modIds.length,
          });

          if (!modPath) {
            api.sendNotification({
              type: 'warning',
              message: `Cannot resolve path for ${modName}`,
              title: 'Skipped',
            });
            continue;
          }

          const result = await service.compressMod(
            modPath,
            DEFAULT_ALGORITHM,
            { isDir: true, modId, measureRoot: modPath },
            gameId,
          );

          if (result.code !== 0) {
            api.sendNotification({
              type: 'warning',
              message: `${modName}: exit code ${result.code}`,
              title: 'Compress Warning',
            });
          }
        }

        sendProgressNotification(api, {
          modId: '',
          modName: `${modIds.length} mods`,
          phase: 'done',
          done: modIds.length,
          total: modIds.length,
        });
      } catch (err: any) {
        api.sendNotification({
          type: 'error',
          message: err?.message ?? 'Unknown error',
          title: 'Compression Failed',
        });
      }
    },
    {
      condition: () => isSupportedGame(context),
      tooltip: 'Compress selected mods with NTFS compression',
    },
  );
}

/**
 * Register decompress mod toolbar action.
 */
export function registerDecompressAction(
  context: IExtensionContext,
  getService: () => CompressionService | undefined,
): void {
  context.registerAction(
    'mods-actionbar',
    101, // group order (after compress)
    'decompress',
    'Decompress Mods',
    async (modIds: string[]) => {
      const api: IExtensionApi = context.api;
      const service = getService();
      if (!service) {
        api.sendNotification({
          type: 'error',
          message: 'Compression service not initialized',
          title: 'Decompression Error',
        });
        return;
      }

      if (!service.isWindows()) {
        api.sendNotification({
          type: 'error',
          message: service.getPlatformError(),
          title: 'Decompression Error',
        });
        return;
      }

      try {
        const state = api.getState();
        const gameId = state?.settings?.gameMode?.id ?? '';

        if (!gameId) {
          api.sendNotification({
            type: 'error',
            message: 'No game selected in Vortex',
            title: 'Decompression Error',
          });
          return;
        }

        for (let i = 0; i < modIds.length; i++) {
          const modId = modIds[i];
          const modName = api.lookupModName?.(gameId, modId) ?? modId;
          const modPath = api.lookupModPath?.(gameId, modId);

          sendProgressNotification(api, {
            modId,
            modName,
            phase: 'decompress',
            done: i,
            total: modIds.length,
          });

          if (!modPath) {
            api.sendNotification({
              type: 'warning',
              message: `Cannot resolve path for ${modName}`,
              title: 'Skipped',
            });
            continue;
          }

          const result = await service.decompressMod(
            modPath,
            gameId,
            modId,
            undefined,
            { measureRoot: modPath },
          );

          if (result.code !== 0) {
            api.sendNotification({
              type: 'warning',
              message: `${modName}: exit code ${result.code}`,
              title: 'Decompress Warning',
            });
          }
        }

        sendProgressNotification(api, {
          modId: '',
          modName: `${modIds.length} mods`,
          phase: 'done',
          done: modIds.length,
          total: modIds.length,
        });
      } catch (err: any) {
        api.sendNotification({
          type: 'error',
          message: err?.message ?? 'Unknown error',
          title: 'Decompression Failed',
        });
      }
    },
    {
      condition: () => isSupportedGame(context),
      tooltip: 'Decompress selected mods (remove NTFS compression)',
    },
  );
}

/**
 * Register both compress and decompress toolbar actions.
 */
export function registerActions(
  context: IExtensionContext,
  getService: () => CompressionService | undefined,
): void {
  registerCompressAction(context, getService);
  registerDecompressAction(context, getService);
}
