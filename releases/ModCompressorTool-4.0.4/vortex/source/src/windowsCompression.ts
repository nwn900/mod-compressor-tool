import { ProcessRunner, RunResult, RunOptions } from './processRunner';
import { parseCompactRatio, parseCompactStorageSizes, hasCompressedMarkers, iterCompactQueryBatches } from './compactOutput';
import { CompressionAlgorithm } from './types';

export interface QueryResult {
  compressed: boolean;
  ratio: number;
  sizes?: { logical: number; physical: number };
}

export interface DecompressRunResult {
  code: number;
  output: string;
  steps: string[];
}

export type CompressionProgressCallback = (done: number, total: number) => void;

export interface MeasureResult {
  fileCount: number;
  totalSize: number;
  diskSize: number;
  ratio: number;
  compressed: boolean;
  algorithm: string;
  skippedFiles: number;
  textureSize: number;
  meshSize: number;
  soundSize: number;
  lodSize: number;
  animationSize: number;
  otherSize: number;
  compressedByAttr: number;
  compressedBySize: number;
  compressedByWof: number;
}

export interface CompressionAdapter {
  compress(path: string, algorithm: CompressionAlgorithm, isDir?: boolean, threads?: number, onProgress?: CompressionProgressCallback): Promise<RunResult>;
  decompress(path: string, threads?: number, onProgress?: CompressionProgressCallback): Promise<DecompressRunResult>;
  compressPaths?(paths: string[], algorithm: CompressionAlgorithm, threads?: number, onProgress?: CompressionProgressCallback): Promise<RunResult>;
  decompressPaths?(paths: string[], threads?: number, onProgress?: CompressionProgressCallback): Promise<DecompressRunResult>;
  query(path: string): Promise<QueryResult>;
  queryFiles(filePaths: string[]): Promise<QueryResult>;
  measure?(path: string, onProgress?: CompressionProgressCallback): Promise<MeasureResult>;
  isWindows(): boolean;
  getPlatformError(): string;
  getMode?(): string;
}

const WOF_ALGORITHMS: CompressionAlgorithm[] = [
  CompressionAlgorithm.XPRESS4K,
  CompressionAlgorithm.XPRESS8K,
  CompressionAlgorithm.XPRESS16K,
  CompressionAlgorithm.LZX,
];

export class CompactAdapter {
  private runner: ProcessRunner;

  constructor(runner?: ProcessRunner) {
    this.runner = runner ?? new ProcessRunner();
  }

  async compress(
    path: string,
    algorithm: CompressionAlgorithm,
    isDir?: boolean,
    _threads?: number,
    onProgress?: CompressionProgressCallback,
  ): Promise<RunResult> {
    if (isDir === undefined) {
      isDir = await this.isDirectory(path);
    }

    const args = [
      'compact.exe',
      '/c',
      '/i',
      '/q',
      `/exe:${algorithm}`,
    ];
    if (isDir) args.push(`/s:${path}`);
    else args.push(path);

    onProgress?.(0, 1);
    const result = await this.runner.run(args, { timeout: 3600 });
    onProgress?.(1, 1);
    return result;
  }

  async decompress(path: string, _threads?: number, onProgress?: CompressionProgressCallback): Promise<DecompressRunResult> {
    const steps: string[] = [];
    let combinedOutput = '';
    let lastCode = 0;
    const isDir = await this.isDirectory(path);

    // Step 1: Try each WOF algorithm
    onProgress?.(0, 1);
    for (const algo of WOF_ALGORITHMS) {
      const args = [
        'compact.exe',
        '/u',
        '/i',
        `/exe:${algo}`,
      ];
      if (isDir) args.push(`/s:${path}`);
      else args.push(path);

      const result = await this.runner.run(args, { timeout: 3600 });
      combinedOutput += `[${algo}] ${result.stdout}\n`;
      steps.push(`${algo}:${result.code}`);
      lastCode = result.code;
    }

    // Step 2: Try NTFS decompression
    const ntfsArgs = [
      'compact.exe',
      '/u',
      '/i',
      '/q',
    ];
    if (isDir) ntfsArgs.push(`/s:${path}`);
    else ntfsArgs.push(path);

    const ntfsResult = await this.runner.run(ntfsArgs, { timeout: 3600 });
    combinedOutput += `[NTFS] ${ntfsResult.stdout}\n`;
    steps.push(`NTFS:${ntfsResult.code}`);

    onProgress?.(1, 1);
    return {
      code: ntfsResult.code === 0 ? 0 : lastCode,
      output: combinedOutput,
      steps,
    };
  }

  async query(path: string): Promise<QueryResult> {
    const args = ['compact.exe', '/q'];
    const isDir = await this.isDirectory(path);
    if (isDir) args.push(`/s:${path}`);
    else args.push(path);

    const result = await this.runner.run(args);
    if (result.code !== 0) {
      return { compressed: false, ratio: 1.0 };
    }

    const ratio = parseCompactRatio(result.stdout);
    const compressed = ratio > 1.0 || hasCompressedMarkers(result.stdout);
    const sizes = parseCompactStorageSizes(result.stdout);

    return { compressed, ratio, sizes };
  }

  async queryFiles(filePaths: string[]): Promise<QueryResult> {
    if (filePaths.length === 0) {
      return { compressed: false, ratio: 1.0 };
    }

    const batches = iterCompactQueryBatches(filePaths);
    let compressed = false;
    let maxRatio = 1.0;
    let maxSizes: { logical: number; physical: number } | undefined;

    for (const batch of batches) {
      const args = ['compact.exe', '/q', ...batch];
      const result = await this.runner.run(args);

      if (result.code === 0) {
        const ratio = parseCompactRatio(result.stdout);
        if (ratio > 1.0 || hasCompressedMarkers(result.stdout)) {
          compressed = true;
        }
        if (ratio > maxRatio) {
          maxRatio = ratio;
        }

        const sizes = parseCompactStorageSizes(result.stdout);
        if (sizes) {
          if (!maxSizes || sizes.physical < maxSizes.physical) {
            maxSizes = sizes;
          }
        }
      }
    }

    return { compressed, ratio: maxRatio, sizes: maxSizes };
  }

  isWindows(): boolean {
    return process.platform === 'win32';
  }

  getPlatformError(): string {
    return 'Windows with NTFS compression support is required for this extension. '
      + 'Compact.exe is only available on Windows with NTFS volumes.';
  }

  private async isDirectory(path: string): Promise<boolean> {
    const { promises: fs } = await import('fs');
    try {
      const stat = await fs.stat(path);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}
