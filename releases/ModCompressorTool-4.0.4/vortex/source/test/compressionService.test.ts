import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompressionService } from '../src/compressionService';
import { CompressionAlgorithm, modInfoFromDict } from '../src/types';

describe('CompressionService', () => {
  let service: CompressionService;
  let mockRunner: { run: ReturnType<typeof vi.fn> };
  let mockAdapter: any;
  let mockStore: any;

  beforeEach(() => {
    mockRunner = { run: vi.fn() };
    mockAdapter = {
      compress: vi.fn(),
      decompress: vi.fn(),
      query: vi.fn(),
      queryFiles: vi.fn(),
      isWindows: vi.fn().mockReturnValue(true),
      getPlatformError: vi.fn().mockReturnValue('Windows required'),
    };
    mockStore = {
      load: vi.fn().mockResolvedValue({}),
      save: vi.fn().mockResolvedValue(true),
      getMod: vi.fn(),
      setMod: vi.fn(),
      removeMod: vi.fn(),
    };

    service = new CompressionService(mockAdapter, mockStore);
  });

  describe('getModInfo()', () => {
    it('returns stored info for existing mod', () => {
      const info = { fileCount: 10, totalSize: 1000, diskSize: 500, ratio: 2.0, compressed: true };
      mockStore.getMod.mockReturnValue(info);

      const result = service.getModInfo('skyrimse', 'someMod');
      expect(result).toBe(info);
      expect(mockStore.getMod).toHaveBeenCalledWith('skyrimse', 'someMod');
    });

    it('returns undefined for missing mod', () => {
      mockStore.getMod.mockReturnValue(undefined);
      expect(service.getModInfo('skyrimse', 'nonexistent')).toBeUndefined();
    });
  });

  describe('compressMod()', () => {
    it('calls adapter.compress with correct args', async () => {
      mockAdapter.compress.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

      await service.compressMod('C:\\mod', CompressionAlgorithm.XPRESS8K);

      expect(mockAdapter.compress).toHaveBeenCalledWith(
        'C:\\mod',
        'xpress8k',
        undefined,
      );
    });

    it('calls adapter.compress with isDir hint', async () => {
      mockAdapter.compress.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
      mockStore.getMod.mockReturnValue({ compressed: false });

      await service.compressMod('C:\\mod', CompressionAlgorithm.LZX, { isDir: true });

      expect(mockAdapter.compress).toHaveBeenCalledWith(
        'C:\\mod',
        'lzx',
        true,
      );
    });

    it('saves state on successful compress', async () => {
      mockAdapter.compress.mockResolvedValue({ code: 0, stdout: 'compressed', stderr: '' });
      mockStore.load.mockResolvedValue({});

      await service.compressMod(
        'C:\\mod\\textures', CompressionAlgorithm.XPRESS4K,
        { modId: 'myMod' }, 'skyrimse',
      );

      expect(mockStore.save).toHaveBeenCalled();
    });

    it('does not save state on failed compress', async () => {
      mockAdapter.compress.mockResolvedValue({ code: 1, stdout: '', stderr: 'error' });

      await service.compressMod('C:\\mod', CompressionAlgorithm.XPRESS4K);

      expect(mockStore.save).not.toHaveBeenCalled();
    });

    it('verifies compression state when no size summary is available', async () => {
      mockAdapter.compress.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
      mockAdapter.query.mockResolvedValue({ compressed: false, ratio: 1.0 });

      const result = await service.compressMod('C:\\mod', CompressionAlgorithm.XPRESS4K);

      expect(mockAdapter.query).toHaveBeenCalledWith('C:\\mod');
      expect(result.modInfo.compressed).toBe(false);
    });

    it('compresses scoped target paths and saves state once', async () => {
      mockAdapter.compress
        .mockResolvedValueOnce({
          code: 0,
          stdout: '1000 total bytes of data are stored in 600 bytes.',
          stderr: '',
        })
        .mockResolvedValueOnce({
          code: 0,
          stdout: '2000 total bytes of data are stored in 1000 bytes.',
          stderr: '',
        });
      mockStore.load.mockResolvedValue({});

      const result = await service.compressModPaths(
        ['C:\\mod\\textures', 'C:\\mod\\meshes'],
        CompressionAlgorithm.LZX,
        { modId: 'myMod' },
        'fallout4',
      );

      expect(mockAdapter.compress).toHaveBeenNthCalledWith(1, 'C:\\mod\\textures', 'lzx', true);
      expect(mockAdapter.compress).toHaveBeenNthCalledWith(2, 'C:\\mod\\meshes', 'lzx', true);
      expect(mockAdapter.query).not.toHaveBeenCalled();
      expect(mockStore.save).toHaveBeenCalledTimes(1);
      expect(result.modInfo.totalSize).toBe(3000);
      expect(result.modInfo.diskSize).toBe(1600);
      expect(result.modInfo.compressed).toBe(true);
    });

    it('keeps existing state when one scoped compression target fails', async () => {
      const existing = modInfoFromDict({ compressed: false, algorithm: '', totalSize: 3000, diskSize: 3000 });
      mockAdapter.compress
        .mockResolvedValueOnce({
          code: 0,
          stdout: '1000 total bytes of data are stored in 600 bytes.',
          stderr: '',
        })
        .mockResolvedValueOnce({
          code: 1,
          stdout: '',
          stderr: 'Access denied',
        });
      mockStore.load.mockResolvedValue({});

      const result = await service.compressModPaths(
        ['C:\\mod\\textures', 'C:\\mod\\meshes'],
        CompressionAlgorithm.LZX,
        { modId: 'myMod' },
        'fallout4',
        existing,
      );

      expect(result.code).toBe(1);
      expect(result.modInfo.compressed).toBe(false);
      expect(result.modInfo.algorithm).toBe('');
      expect(result.modInfo.totalSize).toBe(3000);
      expect(mockStore.save).toHaveBeenCalledTimes(1);
    });

    it('uses exact full-mod measurement after scoped compression', async () => {
      mockAdapter.compress.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
      mockAdapter.measure = vi.fn().mockResolvedValue({
        fileCount: 10,
        totalSize: 5000,
        diskSize: 2500,
        ratio: 2,
        compressed: true,
        algorithm: 'xpress8k',
        skippedFiles: 0,
        textureSize: 3000,
        meshSize: 2000,
        soundSize: 0,
        lodSize: 0,
        animationSize: 0,
        otherSize: 0,
        compressedByAttr: 0,
        compressedBySize: 10,
        compressedByWof: 10,
      });
      mockStore.load.mockResolvedValue({});

      const result = await service.compressModPaths(
        ['C:\\mod\\textures'],
        CompressionAlgorithm.XPRESS8K,
        { modId: 'myMod', measureRoot: 'C:\\mod' },
        'fallout4',
      );

      expect(mockAdapter.measure).toHaveBeenCalledWith('C:\\mod');
      expect(result.modInfo.totalSize).toBe(5000);
      expect(result.modInfo.diskSize).toBe(2500);
      expect(result.modInfo.fileCount).toBe(10);
      expect(mockStore.save.mock.calls[0][1].myMod.totalSize).toBe(5000);
    });
  });

  describe('decompressMod()', () => {
    it('calls adapter.decompress with correct path', async () => {
      mockAdapter.decompress.mockResolvedValue({ code: 0, output: '', steps: ['ok'] });

      await service.decompressMod('C:\\mod');

      expect(mockAdapter.decompress).toHaveBeenCalledWith('C:\\mod');
    });

    it('saves state on successful decompress', async () => {
      mockAdapter.decompress.mockResolvedValue({ code: 0, output: 'decompressed', steps: ['ok'] });
      mockStore.load.mockResolvedValue({});

      await service.decompressMod('C:\\mod\\textures', 'skyrimse', 'myMod');

      expect(mockStore.save).toHaveBeenCalled();
    });

    it('saves decompressed state via load+save', async () => {
      mockAdapter.decompress.mockResolvedValue({ code: 0, output: '', steps: ['ok'] });
      mockStore.load.mockResolvedValue({});

      await service.decompressMod('C:\\mod', 'skyrimse', 'someMod');

      expect(mockStore.load).toHaveBeenCalledWith('skyrimse');
      expect(mockStore.save).toHaveBeenCalled();
      const savedData = mockStore.save.mock.calls[0][1];
      expect(savedData.someMod).toBeDefined();
      expect(savedData.someMod.compressed).toBe(false);
      expect(savedData.someMod.ratio).toBe(1.0);
    });

    it('verifies state after a successful decompress with no size summary', async () => {
      mockAdapter.decompress.mockResolvedValue({ code: 0, output: '', steps: ['ok'] });

      await service.decompressMod('C:\\mod');

      expect(mockAdapter.query).toHaveBeenCalledWith('C:\\mod');
    });

    it('decompresses scoped target paths and saves state once', async () => {
      mockAdapter.decompress
        .mockResolvedValueOnce({
          code: 0,
          output: '1000 total bytes of data are stored in 1000 bytes.',
          steps: ['ok'],
        })
        .mockResolvedValueOnce({
          code: 0,
          output: '2000 total bytes of data are stored in 2000 bytes.',
          steps: ['ok'],
        });
      mockStore.load.mockResolvedValue({});

      const result = await service.decompressModPaths(
        ['C:\\mod\\textures', 'C:\\mod\\meshes'],
        'fallout4',
        'myMod',
      );

      expect(mockAdapter.decompress).toHaveBeenNthCalledWith(1, 'C:\\mod\\textures');
      expect(mockAdapter.decompress).toHaveBeenNthCalledWith(2, 'C:\\mod\\meshes');
      expect(mockAdapter.query).not.toHaveBeenCalled();
      expect(mockStore.save).toHaveBeenCalledTimes(1);
      expect(result.modInfo.compressed).toBe(false);
      expect(result.modInfo.ratio).toBe(1.0);
    });

    it('keeps existing state when one scoped decompression target fails', async () => {
      const existing = modInfoFromDict({
        compressed: true,
        algorithm: CompressionAlgorithm.LZX,
        totalSize: 3000,
        diskSize: 1600,
        ratio: 1.875,
      });
      mockAdapter.decompress
        .mockResolvedValueOnce({
          code: 0,
          output: '1000 total bytes of data are stored in 1000 bytes.',
          steps: ['ok'],
        })
        .mockResolvedValueOnce({
          code: 1,
          output: 'Access denied',
          steps: ['fail'],
        });
      mockStore.load.mockResolvedValue({});

      const result = await service.decompressModPaths(
        ['C:\\mod\\textures', 'C:\\mod\\meshes'],
        'fallout4',
        'myMod',
        existing,
      );

      expect(result.code).toBe(1);
      expect(result.modInfo.compressed).toBe(true);
      expect(result.modInfo.algorithm).toBe(CompressionAlgorithm.LZX);
      expect(result.modInfo.ratio).toBe(1.875);
      expect(mockStore.save).toHaveBeenCalledTimes(1);
    });

    it('uses exact full-mod measurement after scoped decompression', async () => {
      mockAdapter.decompress.mockResolvedValue({ code: 0, output: '', steps: ['native:0'] });
      mockAdapter.measure = vi.fn().mockResolvedValue({
        fileCount: 10,
        totalSize: 5000,
        diskSize: 5000,
        ratio: 1,
        compressed: false,
        algorithm: '',
        skippedFiles: 0,
        textureSize: 3000,
        meshSize: 2000,
        soundSize: 0,
        lodSize: 0,
        animationSize: 0,
        otherSize: 0,
        compressedByAttr: 0,
        compressedBySize: 0,
        compressedByWof: 0,
      });
      mockStore.load.mockResolvedValue({});

      const result = await service.decompressModPaths(
        ['C:\\mod\\textures'],
        'fallout4',
        'myMod',
        undefined,
        { measureRoot: 'C:\\mod' },
      );

      expect(mockAdapter.measure).toHaveBeenCalledWith('C:\\mod');
      expect(result.modInfo.compressed).toBe(false);
      expect(result.modInfo.totalSize).toBe(5000);
      expect(result.modInfo.diskSize).toBe(5000);
      expect(mockStore.save.mock.calls[0][1].myMod.diskSize).toBe(5000);
    });
  });

  describe('isWindows()', () => {
    it('delegates to adapter', () => {
      const result = service.isWindows();
      expect(result).toBe(true);
      expect(mockAdapter.isWindows).toHaveBeenCalled();
    });
  });

  describe('getPlatformError()', () => {
    it('delegates to adapter', () => {
      const result = service.getPlatformError();
      expect(result).toBe('Windows required');
      expect(mockAdapter.getPlatformError).toHaveBeenCalled();
    });
  });
});
