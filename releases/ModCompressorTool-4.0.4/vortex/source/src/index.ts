import { IExtensionApi, IExtensionContext, selectors, util } from 'vortex-api';
import * as path from 'path';
import { CompactAdapter } from './windowsCompression';
import { NativeCompressionAdapter } from './nativeCompression';
import { StateStore } from './stateStore';
import { CompressionService } from './compressionService';
import { BETHESDA_GAME_IDS, COMPRESSIBLE_EXTENSIONS, IGNORE_EXTENSIONS } from './constants';
import { CompressionAlgorithm, DEFAULT_ALGORITHM, COMPRESSION_ALGORITHMS } from './types';
import { registerActions } from './actions';
import { registerSettingsReducer, getSettings, saveSettings } from './settings';
import { ModCompressorPage } from './ModCompressorPage';

export * from './types';
export * from './constants';
export * from './format';
export * from './compactOutput';
export * from './processRunner';
export * from './windowsCompression';
export * from './nativeCompression';
export * from './modScanner';
export * from './compressionService';
export * from './verification';
export * from './targetUtils';
export * from './actions';
export * from './settings';
export { CompressionService, CompactAdapter, StateStore };

function isBethesdaGame(gameId: string): boolean {
  return BETHESDA_GAME_IDS.has(gameId.toLowerCase());
}

function isWindows(): boolean {
  return process.platform === 'win32';
}

let compressionService: CompressionService | undefined;
let compressionServiceGameId: string | undefined;
let unsubscribeServiceStore: (() => void) | undefined;

export function getCompressionService(): CompressionService | undefined {
  return compressionService;
}

function syncCompressionService(context: IExtensionContext): void {
  const api: IExtensionApi = context.api;
  const gameId = selectors.activeGameId(api.getState()) ?? '';
  if (!isBethesdaGame(gameId)) {
    if (compressionService) {
      console.log(`mod-compressor: disabled for unsupported game ${gameId || '(none)'}`);
    }
    compressionService = undefined;
    compressionServiceGameId = undefined;
    return;
  }

  if (compressionService && compressionServiceGameId === gameId) {
    return;
  }

  const userDataPath = util.getVortexPath('userData');
  const store = new StateStore(userDataPath);
  const adapter = new NativeCompressionAdapter();
  compressionService = new CompressionService(adapter, store);
  compressionServiceGameId = gameId;
  console.log(`mod-compressor: initialized for game ${gameId} using ${adapter.getMode()} adapter`);
}

function init(context: IExtensionContext): boolean {
  if (!isWindows()) {
    console.log('mod-compressor: non-Windows platform, extension is inert');
    return true;
  }

  registerSettingsReducer(context);

  if (context.registerMainPage) {
    context.registerMainPage(
      'settings',
      'Mod Compressor',
      ModCompressorPage,
      {
        id: 'mod-compressor',
        priority: 50,
        group: 'per-game',
        visible: () => {
          try {
            const state = context.api.getState();
            const gameId = selectors.activeGameId(state);
            return gameId !== undefined && BETHESDA_GAME_IDS.has(gameId.toLowerCase());
          } catch {
            return false;
          }
        },
        props: () => ({
          api: context.api,
        }),
      },
    );
  }

  // Register toolbar actions for compress/decompress
  registerActions(context, getCompressionService);

  context.once(() => {
    const state = context.api.getState();
    const gameId = selectors.activeGameId(state) ?? '';
    if (!isBethesdaGame(gameId)) {
      const settings = getSettings(state);
      if (!settings.hideNonBethesdaWarning) {
        console.log(`mod-compressor: non-Bethesda game "${gameId}", extension inactive`);
      }
    }
    syncCompressionService(context);

    // Vortex can switch games without reloading an extension. Keep the
    // toolbar actions and their backing service in step with that switch.
    const store = context.api.store;
    if (store && typeof store.subscribe === 'function') {
      unsubscribeServiceStore?.();
      unsubscribeServiceStore = store.subscribe(() => syncCompressionService(context));
    }
  });

  return true;
}

export { init };
export default init;
