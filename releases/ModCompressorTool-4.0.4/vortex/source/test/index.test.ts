import { describe, it, expect } from 'vitest';

// Smoke test: ensure the module exports what it should
describe('extension scaffold', () => {
  it('should have a default init function', async () => {
    const mod = await import('../src/index');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('should have a BETHESDA_GAME_IDS constant', async () => {
    const constants = await import('../src/constants');
    expect(constants.BETHESDA_GAME_IDS).toBeDefined();
    expect(constants.BETHESDA_GAME_IDS.has('skyrimse')).toBe(true);
    expect(constants.BETHESDA_GAME_IDS.has('fallout4')).toBe(true);
    expect(constants.BETHESDA_GAME_IDS.has('starfield')).toBe(true);
  });

  it('should have correct compressible extensions', async () => {
    const constants = await import('../src/constants');
    expect(constants.COMPRESSIBLE_EXTENSIONS.has('.dds')).toBe(true);
    expect(constants.COMPRESSIBLE_EXTENSIONS.has('.nif')).toBe(true);
    expect(constants.COMPRESSIBLE_EXTENSIONS.has('.wav')).toBe(true);
    expect(constants.COMPRESSIBLE_EXTENSIONS.has('.hkx')).toBe(true);
  });

  it('should have correct ignored extensions', async () => {
    const constants = await import('../src/constants');
    expect(constants.IGNORE_EXTENSIONS.has('.bsa')).toBe(true);
    expect(constants.IGNORE_EXTENSIONS.has('.ba2')).toBe(true);
    expect(constants.IGNORE_EXTENSIONS.has('.esp')).toBe(true);
    expect(constants.IGNORE_EXTENSIONS.has('.exe')).toBe(true);
    expect(constants.IGNORE_EXTENSIONS.has('.dll')).toBe(true);
  });

  it('should export CompressionService', async () => {
    const mod = await import('../src/index');
    expect(mod.CompressionService).toBeDefined();
  });

  it('should export CompactAdapter', async () => {
    const mod = await import('../src/index');
    expect(mod.CompactAdapter).toBeDefined();
  });

  it('should export StateStore', async () => {
    const mod = await import('../src/index');
    expect(mod.StateStore).toBeDefined();
  });

  it('should export parseCompactRatio', async () => {
    const mod = await import('../src/index');
    expect(mod.parseCompactRatio).toBeDefined();
  });

  it('should export CompressionAlgorithm enum', async () => {
    const mod = await import('../src/index');
    expect(mod.CompressionAlgorithm).toBeDefined();
    expect(mod.CompressionAlgorithm.LZX).toBe('lzx');
  });

  it('should export getCompressionService', async () => {
    const mod = await import('../src/index');
    expect(mod.getCompressionService).toBeDefined();
    expect(typeof mod.getCompressionService).toBe('function');
  });

  it('should export nowISO', async () => {
    const mod = await import('../src/index');
    expect(mod.nowISO).toBeDefined();
    expect(typeof mod.nowISO).toBe('function');
  });

  it('should export verifyDecompression', async () => {
    const mod = await import('../src/index');
    expect(mod.verifyDecompression).toBeDefined();
    expect(typeof mod.verifyDecompression).toBe('function');
  });

  it('should export matchesTargetPath', async () => {
    const mod = await import('../src/index');
    expect(mod.matchesTargetPath).toBeDefined();
    expect(typeof mod.matchesTargetPath).toBe('function');
  });

  it('should export getSettings', async () => {
    const mod = await import('../src/index');
    expect(mod.getSettings).toBeDefined();
    expect(typeof mod.getSettings).toBe('function');
  });
});
