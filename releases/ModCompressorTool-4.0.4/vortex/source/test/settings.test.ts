import { describe, it, expect, vi } from 'vitest';
import {
  getSettings,
  saveSettings,
  registerSettingsReducer,
  DEFAULT_SETTINGS,
  ModCompressorSettings,
} from '../src/settings';
import { CompressionAlgorithm, TargetType } from '../src/types';

describe('getSettings', () => {
  it('returns defaults when state has no modCompressor settings', () => {
    const state = { settings: {} };
    const result = getSettings(state);
    expect(result.algorithm).toBe(DEFAULT_SETTINGS.algorithm);
    expect(result.targets).toEqual(DEFAULT_SETTINGS.targets);
    expect(result.autoCompressOnInstall).toBe(false);
    expect(result.hideNonBethesdaWarning).toBe(false);
  });

  it('returns defaults when state is undefined', () => {
    const result = getSettings(undefined);
    expect(result.algorithm).toBe(CompressionAlgorithm.XPRESS8K);
  });

  it('returns defaults when settings are null', () => {
    const state = { settings: { modCompressor: null } };
    const result = getSettings(state);
    expect(result.algorithm).toBe(CompressionAlgorithm.XPRESS8K);
  });

  it('reads stored algorithm', () => {
    const state = {
      settings: {
        modCompressor: { algorithm: CompressionAlgorithm.LZX },
      },
    };
    const result = getSettings(state);
    expect(result.algorithm).toBe(CompressionAlgorithm.LZX);
  });

  it('reads stored targets', () => {
    const state = {
      settings: {
        modCompressor: {
          targets: [TargetType.TEXTURES, TargetType.SOUNDS],
        },
      },
    };
    const result = getSettings(state);
    expect(result.targets).toEqual([TargetType.TEXTURES, TargetType.SOUNDS]);
  });

  it('reads autoCompressOnInstall', () => {
    const state = {
      settings: {
        modCompressor: { autoCompressOnInstall: true },
      },
    };
    const result = getSettings(state);
    expect(result.autoCompressOnInstall).toBe(true);
  });

  it('reads hideNonBethesdaWarning', () => {
    const state = {
      settings: {
        modCompressor: { hideNonBethesdaWarning: true },
      },
    };
    const result = getSettings(state);
    expect(result.hideNonBethesdaWarning).toBe(true);
  });

  it('falls back to defaults for missing fields', () => {
    const state = {
      settings: {
        modCompressor: { algorithm: CompressionAlgorithm.LZX },
      },
    };
    const result = getSettings(state);
    expect(result.targets).toEqual(DEFAULT_SETTINGS.targets);
    expect(result.autoCompressOnInstall).toBe(
      DEFAULT_SETTINGS.autoCompressOnInstall,
    );
  });

  it('returns a copy each time', () => {
    const state = {
      settings: {
        modCompressor: { targets: [TargetType.TEXTURES] },
      },
    };
    const a = getSettings(state);
    const b = getSettings(state);
    expect(a).toEqual(b);
    a.targets.push(TargetType.MESHES);
    expect(b.targets).not.toContain(TargetType.MESHES);
  });
});

describe('saveSettings', () => {
  it('dispatches SET_SETTINGS_MOD_COMPRESSOR with payload', () => {
    const dispatch = vi.fn();
    const api = { store: { dispatch } } as any;

    const settings: ModCompressorSettings = {
      algorithm: CompressionAlgorithm.LZX,
      targets: [TargetType.TEXTURES],
      autoCompressOnInstall: true,
      hideNonBethesdaWarning: false,
      updatedAt: '',
    };

    saveSettings(api, settings);

    expect(dispatch).toHaveBeenCalledOnce();
    const action = dispatch.mock.calls[0][0];
    expect(action.type).toBe('SET_SETTINGS_MOD_COMPRESSOR');
    expect(action.payload.algorithm).toBe(CompressionAlgorithm.LZX);
    expect(action.payload.targets).toEqual([TargetType.TEXTURES]);
    expect(action.payload.autoCompressOnInstall).toBe(true);
    expect(action.payload.updatedAt).toBeTruthy();
    expect(typeof action.payload.updatedAt).toBe('string');
  });

  it('overwrites updatedAt with current timestamp', () => {
    const dispatch = vi.fn();
    const api = { store: { dispatch } } as any;

    const settings: ModCompressorSettings = {
      algorithm: CompressionAlgorithm.XPRESS8K,
      targets: [],
      autoCompressOnInstall: false,
      hideNonBethesdaWarning: true,
      updatedAt: 'old-timestamp',
    };

    saveSettings(api, settings);

    const payload = dispatch.mock.calls[0][0].payload;
    expect(payload.updatedAt).not.toBe('old-timestamp');
    expect(payload.updatedAt).toBeTruthy();
  });
});

describe('registerSettingsReducer', () => {
  it('registers a reducer under settings_mod_compressor', () => {
    const registerReducer = vi.fn();
    const context = { registerReducer } as any;

    registerSettingsReducer(context);

    expect(registerReducer).toHaveBeenCalledOnce();
    const [key, reducer] = registerReducer.mock.calls[0];
    expect(key).toBe('settings_mod_compressor');
    expect(typeof reducer).toBe('function');
  });

  it('reducer returns payload on SET_SETTINGS_MOD_COMPRESSOR', () => {
    const registerReducer = vi.fn();
    const context = { registerReducer } as any;
    registerSettingsReducer(context);

    const reducer = registerReducer.mock.calls[0][1];
    const payload = { algorithm: CompressionAlgorithm.LZX };
    const result = reducer(null, { type: 'SET_SETTINGS_MOD_COMPRESSOR', payload });
    expect(result).toBe(payload);
  });

  it('reducer returns previous state for unknown action', () => {
    const registerReducer = vi.fn();
    const context = { registerReducer } as any;
    registerSettingsReducer(context);

    const reducer = registerReducer.mock.calls[0][1];
    const prev = { algorithm: CompressionAlgorithm.LZX };
    const result = reducer(prev, { type: 'UNKNOWN_ACTION' });
    expect(result).toBe(prev);
  });
});
