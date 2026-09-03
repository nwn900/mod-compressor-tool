import { IExtensionApi, IExtensionContext } from 'vortex-api';
import { CompressionAlgorithm, DEFAULT_ALGORITHM, TargetType } from './types';
import { nowISO } from './format';

/**
 * Module-level settings for the mod compressor.
 * Stored in Vortex state under `settings.modCompressor`.
 */
export interface ModCompressorSettings {
  /** Compression algorithm to use */
  algorithm: CompressionAlgorithm;
  /** Selected target types for compression */
  targets: TargetType[];
  /** Whether to enable compression on mod install */
  autoCompressOnInstall: boolean;
  /** Whether to show non-Bethesda game warning */
  hideNonBethesdaWarning: boolean;
  /** Last updated timestamp */
  updatedAt: string;
}

export const DEFAULT_SETTINGS: ModCompressorSettings = {
  algorithm: DEFAULT_ALGORITHM,
  targets: [TargetType.TEXTURES, TargetType.MESHES],
  autoCompressOnInstall: false,
  hideNonBethesdaWarning: false,
  updatedAt: '',
};

/**
 * Read settings from Vortex state.
 */
export function getSettings(state: any): ModCompressorSettings {
  const stored: Partial<ModCompressorSettings> | undefined =
    state?.settings?.modCompressor;

  if (!stored) {
    return { ...DEFAULT_SETTINGS };
  }

  return {
    algorithm: stored.algorithm ?? DEFAULT_SETTINGS.algorithm,
    targets: stored.targets ? [...stored.targets] : [...DEFAULT_SETTINGS.targets],
    autoCompressOnInstall:
      stored.autoCompressOnInstall ?? DEFAULT_SETTINGS.autoCompressOnInstall,
    hideNonBethesdaWarning:
      stored.hideNonBethesdaWarning ?? DEFAULT_SETTINGS.hideNonBethesdaWarning,
    updatedAt: stored.updatedAt ?? '',
  };
}

/**
 * Save settings to Vortex state via the store.
 */
export function saveSettings(
  api: IExtensionApi,
  settings: ModCompressorSettings,
): void {
  const toSave: ModCompressorSettings = {
    ...settings,
    updatedAt: nowISO(),
  };

  api.store.dispatch({
    type: 'SET_SETTINGS_MOD_COMPRESSOR',
    payload: toSave,
  });
}

/**
 * Register a settings reducer with the Vortex state.
 * This is optional if the extension wants to handle state
 * changes explicitly.
 */
export function registerSettingsReducer(context: IExtensionContext): void {
  context.registerReducer?.('settings_mod_compressor', (state: any = null, action: any) => {
    if (action.type === 'SET_SETTINGS_MOD_COMPRESSOR') {
      return action.payload;
    }
    return state;
  });
}
