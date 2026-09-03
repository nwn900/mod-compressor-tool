import { describe, it, expect, vi } from 'vitest';
import { NativeCompressionAdapter } from '../src/nativeCompression';
import { CompressionAlgorithm } from '../src/types';

function helperResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ok: true,
    code: 0,
    message: 'ok',
    version: '0.1.0',
    mode: 'native',
    stats: {
      fileCount: 2,
      totalSize: 1000,
      diskSize: 500,
      skippedFiles: 1,
      textureSize: 700,
      meshSize: 300,
      soundSize: 0,
      lodSize: 0,
      animationSize: 0,
      otherSize: 0,
      compressedByAttr: 0,
      compressedBySize: 2,
      compressedByWof: 2,
      compressed: true,
      ratio: 2,
      algorithm: 'xpress8k',
    },
    processed: 2,
    changed: 2,
    skipped: 0,
    failed: 0,
    errors: [],
    algorithms: ['xpress4k', 'xpress8k', 'xpress16k', 'lzx'],
    ...overrides,
  });
}

describe('NativeCompressionAdapter', () => {
  it('sends compress requests to the helper', async () => {
    const runner = { run: vi.fn().mockResolvedValue({ code: 0, stdout: helperResponse(), stderr: '' }) };
    const adapter = new NativeCompressionAdapter(runner as any, undefined, 'C:\\helper.exe');

    const result = await adapter.compress('C:\\mod\\textures', CompressionAlgorithm.XPRESS16K, true, 4);

    expect(result.code).toBe(0);
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(runner.run.mock.calls[0][0]).toEqual(['C:\\helper.exe']);
    expect(JSON.parse(runner.run.mock.calls[0][1].input).command).toBe('probe');
    const payload = JSON.parse(runner.run.mock.calls[1][1].input);
    expect(payload).toEqual({
      command: 'compress',
      paths: ['C:\\mod\\textures'],
      algorithm: 'xpress16k',
      threads: 4,
    });
  });

  it('maps helper measure stats to MeasureResult', async () => {
    const runner = { run: vi.fn().mockResolvedValue({ code: 0, stdout: helperResponse(), stderr: '' }) };
    const adapter = new NativeCompressionAdapter(runner as any, undefined, 'C:\\helper.exe');

    const measured = await adapter.measure('C:\\mod');

    expect(measured.totalSize).toBe(1000);
    expect(measured.diskSize).toBe(500);
    expect(measured.algorithm).toBe('xpress8k');
    expect(measured.textureSize).toBe(700);
  });

  it('falls back to compact adapter when helper is unavailable', async () => {
    const fallback = {
      compress: vi.fn().mockResolvedValue({ code: 0, stdout: 'compact', stderr: '' }),
      decompress: vi.fn(),
      query: vi.fn(),
      queryFiles: vi.fn(),
      isWindows: vi.fn().mockReturnValue(true),
      getPlatformError: vi.fn(),
    };
    const adapter = new NativeCompressionAdapter(undefined, fallback as any, '');

    const result = await adapter.compress('C:\\mod', CompressionAlgorithm.XPRESS4K, true);

    expect(result.stdout).toBe('compact');
    expect(fallback.compress).toHaveBeenCalledWith('C:\\mod', 'xpress4k', true);
    expect(adapter.getMode()).toBe('compact');
  });

  it('uses compact fast path for XPRESS4K compression when helper is available', async () => {
    const runner = { run: vi.fn().mockResolvedValue({ code: 0, stdout: helperResponse(), stderr: '' }) };
    const fallback = {
      compress: vi.fn().mockResolvedValue({ code: 0, stdout: 'compact-xpress4k', stderr: '' }),
      decompress: vi.fn(),
      query: vi.fn(),
      queryFiles: vi.fn(),
      isWindows: vi.fn().mockReturnValue(true),
      getPlatformError: vi.fn(),
    };
    const adapter = new NativeCompressionAdapter(runner as any, fallback as any, 'C:\\helper.exe');

    const result = await adapter.compress('C:\\mod', CompressionAlgorithm.XPRESS4K, true, 8);

    expect(result.stdout).toBe('compact-xpress4k');
    expect(fallback.compress).toHaveBeenCalledWith('C:\\mod', 'xpress4k', true);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('falls back when the helper response fails protocol validation', async () => {
    const runner = { run: vi.fn().mockResolvedValue({ code: 0, stdout: '{"ok":true}', stderr: '' }) };
    const fallback = {
      compress: vi.fn().mockResolvedValue({ code: 0, stdout: 'compact', stderr: '' }),
      decompress: vi.fn(),
      query: vi.fn(),
      queryFiles: vi.fn(),
      isWindows: vi.fn().mockReturnValue(true),
      getPlatformError: vi.fn(),
    };
    const adapter = new NativeCompressionAdapter(runner as any, fallback as any, 'C:\\helper.exe');

    const result = await adapter.compress('C:\\mod', CompressionAlgorithm.LZX, true);

    expect(result.stdout).toBe('compact');
    expect(fallback.compress).toHaveBeenCalledWith('C:\\mod', 'lzx', true);
  });

  it('forwards helper progress events', async () => {
    const runner = {
      run: vi.fn().mockImplementation(async (_args: string[], options: any) => {
        options.onStdoutLine?.(JSON.stringify({
          event: 'progress', processed: 1, total: 2, path: 'C:\\mod\\one.dds',
          changed: true, skipped: false, failed: false,
        }));
        return { code: 0, stdout: helperResponse(), stderr: '' };
      }),
    };
    const adapter = new NativeCompressionAdapter(runner as any, undefined, 'C:\\helper.exe');
    const progress: Array<[number, number]> = [];

    await adapter.compressPaths?.(
      ['C:\\mod\\textures'], CompressionAlgorithm.LZX, 4,
      (done, total) => progress.push([done, total]),
    );

    expect(progress).toEqual([[1, 2]]);
  });
});
