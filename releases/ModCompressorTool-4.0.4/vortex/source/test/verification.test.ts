import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyDecompression, verifyDecompressionFiles, isRatioDecompressed } from '../src/verification';

describe('isRatioDecompressed()', () => {
  it('returns true for ratio below 1.10 threshold', () => {
    expect(isRatioDecompressed(1.05)).toBe(true);
  });

  it('returns false for ratio at threshold', () => {
    expect(isRatioDecompressed(1.10)).toBe(false);
  });

  it('returns false for ratio above threshold', () => {
    expect(isRatioDecompressed(2.50)).toBe(false);
  });

  it('handles ratio of exactly 1.0', () => {
    expect(isRatioDecompressed(1.0)).toBe(true);
  });
});

describe('verifyDecompression()', () => {
  it('returns decompressed=true when ratio is low', async () => {
    const mockAdapter = {
      queryFiles: vi.fn().mockResolvedValue({
        compressed: false,
        ratio: 1.05,
      }),
    };

    const result = await verifyDecompression('C:\\mod', {
      compactAdapter: mockAdapter as any,
    }, ['C:\\mod\\file.dds', 'C:\\mod\\file.nif']);

    expect(result.isDecompressed).toBe(true);
    expect(result.ratio).toBe(1.05);
  });

  it('returns decompressed=false when ratio is high', async () => {
    const mockAdapter = {
      queryFiles: vi.fn().mockResolvedValue({
        compressed: true,
        ratio: 1.50,
      }),
    };

    const result = await verifyDecompression('C:\\mod', {
      compactAdapter: mockAdapter as any,
    }, ['C:\\mod\\compressed.dds']);

    expect(result.isDecompressed).toBe(false);
    expect(result.ratio).toBe(1.50);
  });
});

describe('verifyDecompressionFiles()', () => {
  it('returns decompressed=true for empty file list', async () => {
    const result = await verifyDecompressionFiles([], {} as any);
    expect(result.isDecompressed).toBe(true);
    expect(result.ratio).toBe(1.0);
  });

  it('queries adapter for file paths', async () => {
    const mockAdapter = {
      queryFiles: vi.fn().mockResolvedValue({
        compressed: false,
        ratio: 1.02,
      }),
    };

    const result = await verifyDecompressionFiles(
      ['C:\\a.dds', 'C:\\b.nif'],
      mockAdapter as any,
    );

    expect(mockAdapter.queryFiles).toHaveBeenCalledWith(['C:\\a.dds', 'C:\\b.nif']);
    expect(result.isDecompressed).toBe(true);
  });
});
