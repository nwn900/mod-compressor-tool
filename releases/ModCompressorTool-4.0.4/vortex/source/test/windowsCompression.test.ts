import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessRunner } from '../src/processRunner';
import { CompactAdapter } from '../src/windowsCompression';
import { CompressionAlgorithm } from '../src/types';

// --- ProcessRunner Tests ---

describe('ProcessRunner', () => {
  let runner: ProcessRunner;

  beforeEach(() => {
    runner = new ProcessRunner();
  });

  it('starts with isRunning false', () => {
    expect(runner.isRunning).toBe(false);
  });

  it('cancel() on idle runner does not throw', () => {
    expect(() => runner.cancel()).not.toThrow();
  });
});

describe('ProcessRunner.run()', () => {
  let runner: ProcessRunner;

  beforeEach(() => {
    runner = new ProcessRunner();
  });

  it('runs a command and returns stdout', async () => {
    const result = await runner.run(['cmd', '/c', 'echo', 'hello']);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.stderr).toBe('');
  });

  it('sets isRunning during execution', async () => {
    const runPromise = runner.run(['cmd', '/c', 'echo', 'test']);
    expect(runner.isRunning).toBe(true);
    await runPromise;
    expect(runner.isRunning).toBe(false);
  });

  it('handles non-existent command gracefully (ENOENT)', async () => {
    const result = await runner.run(['nonexistent_cmd_xyz']);

    expect(result.code).not.toBe(0);
  });

  it('returns non-zero code for failing command', async () => {
    const result = await runner.run(['cmd', '/c', 'exit', '1']);

    expect(result.code).toBe(1);
  });

  it('accepts timeout option', async () => {
    const result = await runner.run(['cmd', '/c', 'echo', 'hi'], { timeout: 5000 });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('hi');
  });

  it('accepts cwd option', async () => {
    const result = await runner.run(['cmd', '/c', 'cd'], { cwd: 'C:\\' });

    expect(result.code).toBe(0);
  });

  it('writes input to stdin', async () => {
    const result = await runner.run(['cmd', '/c', 'more'], { input: 'hello stdin' });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('hello stdin');
  });
});

// --- CompactAdapter Tests ---

describe('CompactAdapter.compress()', () => {
  it('builds correct args for file path', async () => {
    const mockRun = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    const adapter = new CompactAdapter({ run: mockRun } as any);

    await adapter.compress('C:\\mod\\file.dds', CompressionAlgorithm.XPRESS8K);

    expect(mockRun).toHaveBeenCalledTimes(1);
    const args = mockRun.mock.calls[0][0];
    expect(args).toContain('compact.exe');
    expect(args).toContain('/c');
    expect(args).toContain('/i');
    expect(args).toContain('/q');
    expect(args).toContain('/exe:xpress8k');
    expect(args).toContain('C:\\mod\\file.dds');
  });

  it('builds correct args for directory with /s: prefix', async () => {
    const mockRun = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    const adapter = new CompactAdapter({ run: mockRun } as any);

    await adapter.compress('C:\\mod\\textures', CompressionAlgorithm.LZX, true);

    const args = mockRun.mock.calls[0][0];
    expect(args).toContain('/s:C:\\mod\\textures');
  });

  it('passes 3600s timeout', async () => {
    const mockRun = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    const adapter = new CompactAdapter({ run: mockRun } as any);

    await adapter.compress('C:\\mod\\file.dds', CompressionAlgorithm.XPRESS4K);

    const options = mockRun.mock.calls[0][1];
    expect(options.timeout).toBe(3600);
  });
});

describe('CompactAdapter.decompress()', () => {
  it('runs all WOF algorithms then NTFS decompression', async () => {
    const mockRun = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    const adapter = new CompactAdapter({ run: mockRun } as any);

    const result = await adapter.decompress('C:\\mod\\file.dds');

    // 4 WOF steps + 1 NTFS step = 5 calls
    expect(mockRun).toHaveBeenCalledTimes(5);

    // Check WOF steps
    expect(mockRun.mock.calls[0][0]).toContain('/exe:xpress4k');
    expect(mockRun.mock.calls[1][0]).toContain('/exe:xpress8k');
    expect(mockRun.mock.calls[2][0]).toContain('/exe:xpress16k');
    expect(mockRun.mock.calls[3][0]).toContain('/exe:lzx');

    // Check NTFS step has no /exe
    expect(mockRun.mock.calls[4][0]).toContain('/u');
    const ntfsArgs = mockRun.mock.calls[4][0].join(' ');
    expect(ntfsArgs).not.toMatch(/\/exe:/);

    expect(result.steps).toHaveLength(5);
  });

  it('returns combined output', async () => {
    const mockRun = vi.fn().mockResolvedValue({ code: 0, stdout: 'decompressed', stderr: '' });
    const adapter = new CompactAdapter({ run: mockRun } as any);

    const result = await adapter.decompress('C:\\mod\\file.dds');

    expect(result.code).toBe(0);
    expect(result.output).toBeTruthy();
  });

  it('returns steps in result', async () => {
    const mockRun = vi.fn().mockResolvedValue({ code: 0, stdout: 'ok', stderr: '' });
    const adapter = new CompactAdapter({ run: mockRun } as any);

    const result = await adapter.decompress('C:\\mod\\file.dds');

    expect(result.steps.length).toBe(5);
    expect(result.steps[0]).toContain('xpress4k');
    expect(result.steps[4]).toContain('NTFS');
  });
});

describe('CompactAdapter.query()', () => {
  it('returns compressed=true and ratio when output has ratio>1', async () => {
    const output = '  1.50 to 1\n  C  somefile.dds';
    const mockRun = vi.fn().mockResolvedValue({ code: 0, stdout: output, stderr: '' });
    const adapter = new CompactAdapter({ run: mockRun } as any);

    const result = await adapter.query('C:\\mod\\file.dds');

    expect(result.compressed).toBe(true);
    expect(result.ratio).toBe(1.5);
  });

  it('returns compressed=false and ratio=1.0 on error', async () => {
    const mockRun = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'error' });
    const adapter = new CompactAdapter({ run: mockRun } as any);

    const result = await adapter.query('C:\\mod\\file.dds');

    expect(result.compressed).toBe(false);
    expect(result.ratio).toBe(1.0);
  });

  it('returns compressed=true when C markers present', async () => {
    const output = '  C  somefile.dds\n  U  otherfile.dds';
    const mockRun = vi.fn().mockResolvedValue({ code: 0, stdout: output, stderr: '' });
    const adapter = new CompactAdapter({ run: mockRun } as any);

    const result = await adapter.query('C:\\mod\\dir');

    expect(result.compressed).toBe(true);
  });
});

describe('CompactAdapter.queryFiles()', () => {
  it('aggregates results from multiple queries', async () => {
    const mockRun = vi.fn().mockResolvedValue({
      code: 0,
      stdout: '  2.00 to 1\n  C  file.dds\n    1000  :  500',
      stderr: '',
    });
    const adapter = new CompactAdapter({ run: mockRun } as any);

    const result = await adapter.queryFiles(['C:\\a.dds', 'C:\\b.nif']);

    expect(result.compressed).toBe(true);
    expect(result.ratio).toBeGreaterThanOrEqual(2.0);
  });

  it('handles empty file list', async () => {
    const adapter = new CompactAdapter();
    await expect(adapter.queryFiles([])).resolves.toBeDefined();
  });
});

describe('CompactAdapter.isWindows()', () => {
  it('returns correct platform detection', () => {
    const adapter = new CompactAdapter();
    const result = adapter.isWindows();
    expect(typeof result).toBe('boolean');
  });
});

describe('CompactAdapter.getPlatformError()', () => {
  it('returns expected error message', () => {
    const adapter = new CompactAdapter();
    const msg = adapter.getPlatformError();
    expect(msg).toContain('Windows');
    expect(msg).toContain('NTFS');
  });
});
