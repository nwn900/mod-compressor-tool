import { CompressionAdapter, CompressionProgressCallback, MeasureResult, QueryResult } from './windowsCompression';
import { StateStore } from './stateStore';
import { ModInfo, CompressionAlgorithm, modInfoFromDict } from './types';
import { scanMod, ScanOptions } from './modScanner';
import { parseCompressOutputSizes } from './compactOutput';

export interface CompressResult {
  code: number;
  output: string;
  stderr: string;
  modInfo: ModInfo;
}

export interface DecompressResult {
  code: number;
  output: string;
  steps: string[];
  modInfo: ModInfo;
}

export interface CompressOptions {
  isDir?: boolean;
  modId?: string;
  threads?: number;
  measureRoot?: string;
  onProgress?: CompressionProgressCallback;
}

export interface DecompressOptions {
  threads?: number;
  measureRoot?: string;
  onProgress?: CompressionProgressCallback;
}

export class CompressionService {
  private adapter: CompressionAdapter;
  private store: StateStore;

  constructor(adapter: CompressionAdapter, store: StateStore) {
    this.adapter = adapter;
    this.store = store;
  }

  getModInfo(gameId: string, modId: string): ModInfo | undefined {
    return this.store.getMod(gameId, modId);
  }

  async getAllMods(gameId: string): Promise<Record<string, ModInfo>> {
    return this.store.load(gameId);
  }

  async compressMod(
    path: string,
    algorithm: CompressionAlgorithm,
    options?: CompressOptions,
    gameId?: string,
    fallbackInfo?: ModInfo,
  ): Promise<CompressResult> {
    const result = options?.onProgress
      ? await this.adapter.compress(path, algorithm, options?.isDir, options?.threads, options.onProgress)
      : options?.threads !== undefined
        ? await this.adapter.compress(path, algorithm, options?.isDir, options.threads)
        : await this.adapter.compress(path, algorithm, options?.isDir);
    const existing = fallbackInfo || modInfoFromDict({});
    const measured = result.code === 0
      ? await this.measureModInfo(options?.measureRoot ?? path, existing, algorithm, options?.onProgress)
      : undefined;
    if (measured) {
      if (gameId && options?.modId) {
        await this.saveModInfo(gameId, options.modId, measured);
      }
      return { code: result.code, output: result.stdout, stderr: result.stderr, modInfo: measured };
    }

    // Prefer measured metadata. If it is unavailable, parse compact output
    // and then query the adapter rather than treating exit code 0 as proof
    // that a file changed.
    const compressSizes = parseCompressOutputSizes(result.stdout);
    if (result.code === 0 && compressSizes && compressSizes.physical < compressSizes.logical) {
      const modInfo: ModInfo = modInfoFromDict({
        compressed: true,
        algorithm,
        compressedAt: new Date().toISOString(),
        totalSize: compressSizes.logical,
        diskSize: compressSizes.physical,
        ratio: compressSizes.logical / compressSizes.physical,
        textureSize: existing.textureSize ?? 0,
        meshSize: existing.meshSize ?? 0,
        soundSize: existing.soundSize ?? 0,
        lodSize: existing.lodSize ?? 0,
        animationSize: existing.animationSize ?? 0,
        otherSize: existing.otherSize ?? 0,
        scannedAt: existing.scannedAt || new Date().toISOString(),
      });
      if (gameId && options?.modId) {
        const allMods = await this.store.load(gameId);
        allMods[options.modId] = modInfo;
        await this.store.save(gameId, allMods);
      }
      return { code: 0, output: result.stdout, stderr: result.stderr, modInfo };
    }

    // A successful command is not proof that any file changed. Verify the
    // resulting state when a measurement was not available.
    let query: QueryResult | undefined;
    try { query = await this.adapter.query(path); } catch { /* */ }
    const actuallyCompressed = query?.compressed ?? existing.compressed ?? false;

    const modInfo: ModInfo = { ...existing,
      compressed: actuallyCompressed,
      algorithm: actuallyCompressed ? (existing.algorithm || algorithm) : '',
      compressedAt: actuallyCompressed ? (existing.compressedAt || new Date().toISOString()) : '',
      ratio: query?.ratio ?? (existing.ratio || 1.0),
      scannedAt: existing.scannedAt || new Date().toISOString(),
    };

    if (gameId && options?.modId) {
      const allMods = await this.store.load(gameId);
      allMods[options.modId] = modInfo;
      await this.store.save(gameId, allMods);
    }

    return { code: result.code, output: result.stdout, stderr: result.stderr, modInfo };
  }

  async compressModPaths(
    paths: string[],
    algorithm: CompressionAlgorithm,
    options?: CompressOptions,
    gameId?: string,
    fallbackInfo?: ModInfo,
  ): Promise<CompressResult> {
    const existing = fallbackInfo || modInfoFromDict({});
    const outputs: string[] = [];
    const stderrs: string[] = [];
    let code = 0;
    let logical = 0;
    let physical = 0;
    let hasSizes = false;

    const batchResults: Array<{ code: number; stdout: string; stderr: string }> = [];
    if (this.adapter.compressPaths) {
      const result = options?.onProgress
        ? await this.adapter.compressPaths.call(this.adapter, paths, algorithm, options?.threads, options.onProgress)
        : await this.adapter.compressPaths.call(this.adapter, paths, algorithm, options?.threads);
      batchResults.push(result);
    } else {
      for (const targetPath of paths) {
        const result = options?.onProgress
          ? await this.adapter.compress(targetPath, algorithm, true, options?.threads, options.onProgress)
          : options?.threads !== undefined
            ? await this.adapter.compress(targetPath, algorithm, true, options.threads)
            : await this.adapter.compress(targetPath, algorithm, true);
        batchResults.push(result);
      }
    }

    for (const result of batchResults) {
      outputs.push(result.stdout);
      if (result.stderr) stderrs.push(result.stderr);
      if (result.code !== 0) code = result.code;

      const sizes = parseCompressOutputSizes(result.stdout);
      if (code === 0 && sizes && sizes.logical > 0 && sizes.physical > 0) {
        logical += sizes.logical;
        physical += sizes.physical;
        hasSizes = true;
      }
    }

    const now = new Date().toISOString();
    const succeeded = code === 0;
    const measured = succeeded
      ? await this.measureModInfo(options?.measureRoot, existing, algorithm, options?.onProgress)
      : undefined;
    if (measured) {
      if (gameId && options?.modId) {
        await this.saveModInfo(gameId, options.modId, measured);
      }
      return { code, output: outputs.join('\n'), stderr: stderrs.join('\n'), modInfo: measured };
    }

    let query: QueryResult | undefined;
    if (succeeded && !hasSizes && paths.length > 0) {
      try { query = await this.adapter.query(options?.measureRoot ?? paths[0]); } catch { /* */ }
    }
    const compressed = succeeded && hasSizes ? true : query?.compressed ?? existing.compressed;
    const modInfo: ModInfo = succeeded && hasSizes
      ? modInfoFromDict({
          compressed: true,
          algorithm,
          compressedAt: now,
          totalSize: logical,
          diskSize: physical,
          ratio: physical > 0 ? logical / physical : existing.ratio || 1.0,
          textureSize: existing.textureSize ?? 0,
          meshSize: existing.meshSize ?? 0,
          soundSize: existing.soundSize ?? 0,
          lodSize: existing.lodSize ?? 0,
          animationSize: existing.animationSize ?? 0,
          otherSize: existing.otherSize ?? 0,
          scannedAt: existing.scannedAt || now,
        })
      : {
          ...existing,
          compressed,
          algorithm: compressed ? (existing.algorithm || algorithm) : existing.algorithm,
          compressedAt: compressed ? (existing.compressedAt || now) : existing.compressedAt,
      ratio: query?.ratio ?? (existing.ratio || 1.0),
          scannedAt: existing.scannedAt || now,
        };

    if (gameId && options?.modId) {
      await this.saveModInfo(gameId, options.modId, modInfo);
    }

    return { code, output: outputs.join('\n'), stderr: stderrs.join('\n'), modInfo };
  }

  async decompressMod(
    path: string,
    gameId?: string,
    modId?: string,
    fallbackInfo?: ModInfo,
    options?: DecompressOptions,
  ): Promise<DecompressResult> {
    const result = options?.onProgress
      ? await this.adapter.decompress(path, options?.threads, options.onProgress)
      : options?.threads !== undefined
        ? await this.adapter.decompress(path, options.threads)
        : await this.adapter.decompress(path);
    const existing = fallbackInfo || modInfoFromDict({});
    const measured = result.code === 0
      ? await this.measureModInfo(options?.measureRoot ?? path, existing, undefined, options?.onProgress)
      : undefined;
    if (measured) {
      if (gameId && modId) {
        await this.saveModInfo(gameId, modId, measured);
      }
      return { code: result.code, output: result.output, steps: result.steps, modInfo: measured };
    }

    // Prefer measured metadata. If it is unavailable, parse compact output
    // and then query the adapter rather than treating exit code 0 as proof
    // that a file changed.
    const decompSizes = parseCompressOutputSizes(result.output);
    if (result.code === 0 && decompSizes) {
      const modInfo: ModInfo = modInfoFromDict({
        compressed: false,
        algorithm: '',
        compressedAt: '',
        totalSize: decompSizes.logical,
        diskSize: decompSizes.physical,
        ratio: decompSizes.logical / decompSizes.physical,
        textureSize: existing.textureSize ?? 0,
        meshSize: existing.meshSize ?? 0,
        soundSize: existing.soundSize ?? 0,
        lodSize: existing.lodSize ?? 0,
        animationSize: existing.animationSize ?? 0,
        otherSize: existing.otherSize ?? 0,
        scannedAt: existing.scannedAt || new Date().toISOString(),
      });
      if (gameId && modId) {
        const allMods = await this.store.load(gameId);
        allMods[modId] = modInfo;
        await this.store.save(gameId, allMods);
      }
      return { code: 0, output: result.output, steps: result.steps, modInfo };
    }

    // A successful command is not proof that any file changed. Verify the
    // resulting state when a measurement was not available.
    let query: QueryResult | undefined;
    try { query = await this.adapter.query(path); } catch { /* */ }
    const actuallyCompressed = query?.compressed ?? existing.compressed ?? false;

    const modInfo: ModInfo = { ...existing,
      compressed: actuallyCompressed,
      algorithm: actuallyCompressed ? existing.algorithm : '',
      compressedAt: actuallyCompressed ? existing.compressedAt : '',
       ratio: query?.ratio ?? (actuallyCompressed ? (existing.ratio || 1.0) : 1.0),
      scannedAt: existing.scannedAt || new Date().toISOString(),
    };

    if (gameId && modId) {
      const allMods = await this.store.load(gameId);
      allMods[modId] = modInfo;
      await this.store.save(gameId, allMods);
    }

    return { code: result.code, output: result.output, steps: result.steps, modInfo };
  }

  async decompressModPaths(
    paths: string[],
    gameId?: string,
    modId?: string,
    fallbackInfo?: ModInfo,
    options?: DecompressOptions,
  ): Promise<DecompressResult> {
    const existing = fallbackInfo || modInfoFromDict({});
    const outputs: string[] = [];
    const steps: string[] = [];
    let code = 0;
    let logical = 0;
    let physical = 0;
    let hasSizes = false;

    const batchResults: Array<{ code: number; output: string; steps: string[] }> = [];
    if (this.adapter.decompressPaths) {
      const result = options?.onProgress
        ? await this.adapter.decompressPaths.call(this.adapter, paths, options?.threads, options.onProgress)
        : await this.adapter.decompressPaths.call(this.adapter, paths, options?.threads);
      batchResults.push(result);
    } else {
      for (const targetPath of paths) {
        const result = options?.onProgress
          ? await this.adapter.decompress(targetPath, options?.threads, options.onProgress)
          : options?.threads !== undefined
            ? await this.adapter.decompress(targetPath, options.threads)
            : await this.adapter.decompress(targetPath);
        batchResults.push(result);
      }
    }

    for (const result of batchResults) {
      outputs.push(result.output);
      steps.push(...result.steps);
      if (result.code !== 0) code = result.code;

      const sizes = parseCompressOutputSizes(result.output);
      if (code === 0 && sizes && sizes.logical > 0 && sizes.physical > 0) {
        logical += sizes.logical;
        physical += sizes.physical;
        hasSizes = true;
      }
    }

    const now = new Date().toISOString();
    const succeeded = code === 0;
    const measured = succeeded
      ? await this.measureModInfo(options?.measureRoot, existing, undefined, options?.onProgress)
      : undefined;
    if (measured) {
      if (gameId && modId) {
        await this.saveModInfo(gameId, modId, measured);
      }
      return { code, output: outputs.join('\n'), steps, modInfo: measured };
    }

    let query: QueryResult | undefined;
    if (succeeded && !hasSizes && paths.length > 0) {
      try { query = await this.adapter.query(options?.measureRoot ?? paths[0]); } catch { /* */ }
    }
    const compressed = succeeded && hasSizes ? false : query?.compressed ?? existing.compressed;
    const modInfo: ModInfo = succeeded && hasSizes
      ? modInfoFromDict({
          compressed: false,
          algorithm: '',
          compressedAt: '',
          totalSize: logical,
          diskSize: physical,
          ratio: physical > 0 ? logical / physical : 1.0,
          textureSize: existing.textureSize ?? 0,
          meshSize: existing.meshSize ?? 0,
          soundSize: existing.soundSize ?? 0,
          lodSize: existing.lodSize ?? 0,
          animationSize: existing.animationSize ?? 0,
          otherSize: existing.otherSize ?? 0,
          scannedAt: existing.scannedAt || now,
        })
      : {
          ...existing,
          compressed,
          algorithm: compressed ? existing.algorithm : '',
          compressedAt: compressed ? existing.compressedAt : '',
          ratio: query?.ratio ?? (compressed ? existing.ratio : 1.0),
          scannedAt: existing.scannedAt || now,
        };

    if (gameId && modId) {
      await this.saveModInfo(gameId, modId, modInfo);
    }

    return { code, output: outputs.join('\n'), steps, modInfo };
  }

  async scanAndSave(
    modRoot: string,
    gameId: string,
    modId: string,
    options?: ScanOptions,
  ): Promise<ModInfo> {
    const measured = await this.measureModInfo(modRoot, modInfoFromDict({}), undefined, options?.onProgress);
    if (measured) {
      await this.saveModInfo(gameId, modId, measured);
      return measured;
    }

    const result = await scanMod(modRoot, options);
    await this.saveModInfo(gameId, modId, result.info);
    return result.info;
  }

  async removeMod(gameId: string, modId: string): Promise<void> {
    this.store.removeMod(gameId, modId);
  }

  private async saveModInfo(gameId: string, modId: string, modInfo: ModInfo): Promise<void> {
    const allMods = await this.store.load(gameId);
    allMods[modId] = modInfo;
    await this.store.save(gameId, allMods);
  }

  private async measureModInfo(
    measureRoot: string | undefined,
    existing: ModInfo,
    compressedAlgorithm?: CompressionAlgorithm,
    onProgress?: CompressionProgressCallback,
  ): Promise<ModInfo | undefined> {
    if (!measureRoot || !this.adapter.measure) {
      return undefined;
    }

    let measured: MeasureResult;
    try {
      measured = onProgress
        ? await this.adapter.measure(measureRoot, onProgress)
        : await this.adapter.measure(measureRoot);
    } catch {
      return undefined;
    }

    const now = new Date().toISOString();
    const algorithm = measured.compressed
      ? (measured.algorithm || compressedAlgorithm || existing.algorithm || '')
      : '';

    return modInfoFromDict({
      fileCount: measured.fileCount,
      totalSize: measured.totalSize,
      diskSize: measured.diskSize,
      ratio: measured.ratio || 1.0,
      compressed: measured.compressed,
      algorithm,
      compressedAt: measured.compressed ? (existing.compressedAt || now) : '',
      scannedAt: now,
      skippedFiles: measured.skippedFiles,
      textureSize: measured.textureSize,
      meshSize: measured.meshSize,
      soundSize: measured.soundSize,
      lodSize: measured.lodSize,
      animationSize: measured.animationSize,
      otherSize: measured.otherSize,
      compressedByAttr: measured.compressedByAttr,
      compressedBySize: measured.compressedBySize,
      compressedByWof: measured.compressedByWof,
    });
  }

  isWindows(): boolean {
    return this.adapter.isWindows();
  }

  getPlatformError(): string {
    return this.adapter.getPlatformError();
  }
}
