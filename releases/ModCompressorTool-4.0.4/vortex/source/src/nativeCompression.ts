import * as fs from 'fs';
import * as path from 'path';
import { ProcessRunner, RunResult } from './processRunner';
import {
  CompactAdapter,
  CompressionAdapter,
  DecompressRunResult,
  MeasureResult,
  QueryResult,
  CompressionProgressCallback,
} from './windowsCompression';
import { CompressionAlgorithm } from './types';

interface HelperStats {
  fileCount: number;
  totalSize: number;
  diskSize: number;
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
  compressed: boolean;
  ratio: number;
  algorithm: string;
}

interface HelperResponse {
  ok: boolean;
  code: number;
  message: string;
  version: string;
  mode: string;
  stats: HelperStats;
  processed: number;
  changed: number;
  skipped: number;
  failed: number;
  errors: Array<{ path: string; code: number; message: string }>;
  algorithms: string[];
}

interface HelperProgress {
  event: 'progress';
  processed: number;
  total: number;
  path: string;
  changed: boolean;
  skipped: boolean;
  failed: boolean;
}

const HELPER_PROTOCOL_VERSION = '0.1.0';

export class NativeCompressionAdapter implements CompressionAdapter {
  private runner: ProcessRunner;
  private fallback: CompactAdapter;
  private helperPath: string | null;
  private helperChecked = false;

  constructor(runner?: ProcessRunner, fallback?: CompactAdapter, helperPath?: string) {
    this.runner = runner ?? new ProcessRunner();
    this.fallback = fallback ?? new CompactAdapter();
    this.helperPath = helperPath ?? this.findHelperPath();
  }

  async compress(
    targetPath: string,
    algorithm: CompressionAlgorithm,
    isDir?: boolean,
    threads?: number,
    onProgress?: CompressionProgressCallback,
  ): Promise<RunResult> {
    if (!this.helperPath || algorithm === CompressionAlgorithm.XPRESS4K || !(await this.ensureHelperReady())) {
      return onProgress
        ? this.fallback.compress(targetPath, algorithm, isDir, undefined, onProgress)
        : this.fallback.compress(targetPath, algorithm, isDir);
    }

    const response = await this.callHelper('compress', [targetPath], algorithm, threads, onProgress);
    return {
      code: response.code,
      stdout: JSON.stringify(response),
      stderr: this.errorSummary(response),
    };
  }

  async decompress(targetPath: string, threads?: number, onProgress?: CompressionProgressCallback): Promise<DecompressRunResult> {
    if (!this.helperPath || !(await this.ensureHelperReady())) {
      return onProgress
        ? this.fallback.decompress(targetPath, undefined, onProgress)
        : this.fallback.decompress(targetPath);
    }

    const response = await this.callHelper('decompress', [targetPath], undefined, threads, onProgress);
    return {
      code: response.code,
      output: JSON.stringify(response),
      steps: [`native:${response.code}`],
    };
  }

  async compressPaths(
    paths: string[],
    algorithm: CompressionAlgorithm,
    threads?: number,
    onProgress?: CompressionProgressCallback,
  ): Promise<RunResult> {
    if (!this.helperPath || algorithm === CompressionAlgorithm.XPRESS4K || !(await this.ensureHelperReady())) {
      return this.runFallbackCompression(paths, algorithm, onProgress);
    }

    const response = await this.callHelper('compress', paths, algorithm, threads, onProgress);
    return {
      code: response.code,
      stdout: JSON.stringify(response),
      stderr: this.errorSummary(response),
    };
  }

  async decompressPaths(
    paths: string[],
    threads?: number,
    onProgress?: CompressionProgressCallback,
  ): Promise<DecompressRunResult> {
    if (!this.helperPath || !(await this.ensureHelperReady())) {
      return this.runFallbackDecompression(paths, onProgress);
    }

    const response = await this.callHelper('decompress', paths, undefined, threads, onProgress);
    return {
      code: response.code,
      output: JSON.stringify(response),
      steps: [`native:${response.code}`],
    };
  }

  async query(targetPath: string): Promise<QueryResult> {
    if (!this.helperPath || !(await this.ensureHelperReady())) {
      return this.fallback.query(targetPath);
    }

    const measured = await this.measure(targetPath);
    return {
      compressed: measured.compressed,
      ratio: measured.ratio,
      sizes: { logical: measured.totalSize, physical: measured.diskSize },
    };
  }

  async queryFiles(filePaths: string[]): Promise<QueryResult> {
    if (!this.helperPath || !(await this.ensureHelperReady())) {
      return this.fallback.queryFiles(filePaths);
    }

    const measured = await this.measurePaths(filePaths);
    return {
      compressed: measured.compressed,
      ratio: measured.ratio,
      sizes: { logical: measured.totalSize, physical: measured.diskSize },
    };
  }

  async measure(targetPath: string, onProgress?: CompressionProgressCallback): Promise<MeasureResult> {
    if (!this.helperPath || !(await this.ensureHelperReady())) {
      throw new Error('native helper unavailable');
    }
    return this.measurePaths([targetPath], onProgress);
  }

  isWindows(): boolean {
    return this.fallback.isWindows();
  }

  getPlatformError(): string {
    return this.fallback.getPlatformError();
  }

  getMode(): string {
    return this.helperPath ? 'native' : 'compact';
  }

  private async measurePaths(paths: string[], onProgress?: CompressionProgressCallback): Promise<MeasureResult> {
    const response = await this.callHelper('measure', paths, undefined, undefined, onProgress);
    return this.toMeasureResult(response.stats);
  }

  private async callHelper(
    command: string,
    paths: string[],
    algorithm?: CompressionAlgorithm,
    threads?: number,
    onProgress?: CompressionProgressCallback,
  ): Promise<HelperResponse> {
    if (!this.helperPath) {
      throw new Error('native helper unavailable');
    }

    const payload = JSON.stringify({
      command,
      paths,
      algorithm,
      threads,
    });
    const result = await this.runner.run([this.helperPath], {
      input: payload,
      timeout: 7200,
      onStdoutLine: (line) => {
        const progress = this.parseProgressLine(line);
        if (progress) onProgress?.(progress.processed, progress.total);
      },
    });
    if (result.code !== 0 && !result.stdout.trim()) {
      throw new Error(result.stderr || `native helper failed with code ${result.code}`);
    }

    const parsed = this.parseHelperResponse(result.stdout);
    if (parsed.code !== 0 && command === 'measure') {
      throw new Error(this.errorSummary(parsed) || parsed.message);
    }
    return parsed;
  }

  private parseHelperResponse(stdout: string): HelperResponse {
    const trimmed = stdout.trim();
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index--) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[index]);
      } catch {
        if (index === lines.length - 1) {
          throw new Error('native helper returned invalid JSON');
        }
        continue;
      }
      if (this.isProgress(parsed)) continue;
      return this.validateHelperResponse(parsed);
    }
    throw new Error('native helper returned no final response');
  }

  private parseProgressLine(line: string): HelperProgress | undefined {
    try {
      const parsed: unknown = JSON.parse(line);
      return this.isProgress(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private isProgress(value: unknown): value is HelperProgress {
    if (!this.isRecord(value) || value.event !== 'progress') return false;
    return this.isNonNegativeInteger(value.processed)
      && this.isNonNegativeInteger(value.total)
      && typeof value.path === 'string'
      && typeof value.changed === 'boolean'
      && typeof value.skipped === 'boolean'
      && typeof value.failed === 'boolean';
  }

  private validateHelperResponse(value: unknown): HelperResponse {
    if (!this.isRecord(value)) throw new Error('native helper response must be an object');
    if (value.version !== HELPER_PROTOCOL_VERSION) {
      throw new Error(`unsupported native helper protocol: ${String(value.version ?? 'missing')}`);
    }
    if (typeof value.ok !== 'boolean' || !Number.isSafeInteger(value.code)) {
      throw new Error('native helper response has invalid status fields');
    }
    if (typeof value.message !== 'string' || value.mode !== 'native') {
      throw new Error('native helper response has invalid metadata');
    }
    if (!this.isRecord(value.stats)) throw new Error('native helper response is missing stats');

    const stats = this.validateStats(value.stats);
    if (!Array.isArray(value.errors)) throw new Error('native helper response has invalid errors');
    const errors = value.errors.map((error, index) => {
      if (!this.isRecord(error)
        || typeof error.path !== 'string'
        || !Number.isSafeInteger(error.code)
        || typeof error.message !== 'string') {
        throw new Error(`native helper response has invalid error at index ${index}`);
      }
      return { path: error.path as string, code: error.code as number, message: error.message as string };
    });
    if (!Array.isArray(value.algorithms) || !value.algorithms.every((algorithm) => typeof algorithm === 'string')) {
      throw new Error('native helper response has invalid algorithms');
    }
    for (const field of ['processed', 'changed', 'skipped', 'failed'] as const) {
      if (!this.isNonNegativeInteger(value[field])) {
        throw new Error(`native helper response has invalid ${field}`);
      }
    }

    return {
      ok: value.ok as boolean,
      code: value.code as number,
      message: value.message as string,
      version: value.version as string,
      mode: value.mode as string,
      stats,
      processed: value.processed as number,
      changed: value.changed as number,
      skipped: value.skipped as number,
      failed: value.failed as number,
      errors,
      algorithms: value.algorithms as string[],
    };
  }

  private validateStats(value: Record<string, unknown>): HelperStats {
    const integerFields = [
      'fileCount', 'totalSize', 'diskSize', 'skippedFiles', 'textureSize', 'meshSize',
      'soundSize', 'lodSize', 'animationSize', 'otherSize', 'compressedByAttr',
      'compressedBySize', 'compressedByWof',
    ] as const;
    for (const field of integerFields) {
      if (!this.isNonNegativeInteger(value[field])) {
        throw new Error(`native helper response has invalid stats.${field}`);
      }
    }
    if (typeof value.compressed !== 'boolean'
      || typeof value.algorithm !== 'string'
      || typeof value.ratio !== 'number'
      || !Number.isFinite(value.ratio)
      || value.ratio < 0) {
      throw new Error('native helper response has invalid stats metadata');
    }
    return {
      fileCount: value.fileCount as number,
      totalSize: value.totalSize as number,
      diskSize: value.diskSize as number,
      skippedFiles: value.skippedFiles as number,
      textureSize: value.textureSize as number,
      meshSize: value.meshSize as number,
      soundSize: value.soundSize as number,
      lodSize: value.lodSize as number,
      animationSize: value.animationSize as number,
      otherSize: value.otherSize as number,
      compressedByAttr: value.compressedByAttr as number,
      compressedBySize: value.compressedBySize as number,
      compressedByWof: value.compressedByWof as number,
      compressed: value.compressed as boolean,
      ratio: value.ratio as number,
      algorithm: value.algorithm as string,
    };
  }

  private isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private async ensureHelperReady(): Promise<boolean> {
    if (!this.helperPath) return false;
    if (this.helperChecked) return true;
    try {
      const response = await this.callHelper('probe', []);
      if (response.code !== 0) throw new Error(response.message || 'native helper probe failed');
      this.helperChecked = true;
      return true;
    } catch {
      this.helperPath = null;
      return false;
    }
  }

  private async runFallbackCompression(
    paths: string[],
    algorithm: CompressionAlgorithm,
    onProgress?: CompressionProgressCallback,
  ): Promise<RunResult> {
    const outputs: string[] = [];
    const stderrs: string[] = [];
    let code = 0;
    for (let index = 0; index < paths.length; index++) {
      const result = await this.fallback.compress(paths[index], algorithm, true);
      outputs.push(result.stdout);
      if (result.stderr) stderrs.push(result.stderr);
      if (result.code !== 0) code = result.code;
      onProgress?.(index + 1, paths.length);
    }
    return { code, stdout: outputs.join('\n'), stderr: stderrs.join('\n') };
  }

  private async runFallbackDecompression(
    paths: string[],
    onProgress?: CompressionProgressCallback,
  ): Promise<DecompressRunResult> {
    const outputs: string[] = [];
    const steps: string[] = [];
    let code = 0;
    for (let index = 0; index < paths.length; index++) {
      const result = await this.fallback.decompress(paths[index]);
      outputs.push(result.output);
      steps.push(...result.steps);
      if (result.code !== 0) code = result.code;
      onProgress?.(index + 1, paths.length);
    }
    return { code, output: outputs.join('\n'), steps };
  }

  private toMeasureResult(stats: HelperStats): MeasureResult {
    return {
      fileCount: stats.fileCount ?? 0,
      totalSize: stats.totalSize ?? 0,
      diskSize: stats.diskSize ?? 0,
      ratio: stats.ratio || 1.0,
      compressed: Boolean(stats.compressed),
      algorithm: stats.algorithm || '',
      skippedFiles: stats.skippedFiles ?? 0,
      textureSize: stats.textureSize ?? 0,
      meshSize: stats.meshSize ?? 0,
      soundSize: stats.soundSize ?? 0,
      lodSize: stats.lodSize ?? 0,
      animationSize: stats.animationSize ?? 0,
      otherSize: stats.otherSize ?? 0,
      compressedByAttr: stats.compressedByAttr ?? 0,
      compressedBySize: stats.compressedBySize ?? 0,
      compressedByWof: stats.compressedByWof ?? 0,
    };
  }

  private errorSummary(response: HelperResponse): string {
    if (!response.errors?.length) {
      return '';
    }
    return response.errors
      .slice(0, 5)
      .map((err) => `${err.path}: ${err.message} (${err.code})`)
      .join('\n');
  }

  private findHelperPath(): string | null {
    const candidates = [
      path.join(__dirname, 'native', 'mod-compressor-helper.exe'),
      path.join(__dirname, 'mod-compressor-helper.exe'),
      path.join(process.cwd(), 'native', 'mod-compressor-helper.exe'),
      path.join(process.cwd(), 'native', 'mod-compressor-helper', 'target', 'release', 'mod-compressor-helper.exe'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }
}
