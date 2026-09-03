import { CompactAdapter } from './windowsCompression';

export interface VerifyResult {
  isDecompressed: boolean;
  ratio: number;
  checkedFiles: number;
}

const DECOMPRESSED_THRESHOLD = 1.10;

export function isRatioDecompressed(ratio: number): boolean {
  return ratio < DECOMPRESSED_THRESHOLD;
}

export async function verifyDecompression(
  modRoot: string,
  options: { compactAdapter: CompactAdapter; maxCheck?: number },
  discoveredPaths?: string[],
): Promise<VerifyResult> {
  const { compactAdapter, maxCheck = 200 } = options;
  const checkedPaths = discoveredPaths ?? [];
  const checked = checkedPaths.length;

  if (checkedPaths.length === 0) {
    return { isDecompressed: true, ratio: 1.0, checkedFiles: 0 };
  }

  const limited = checkedPaths.slice(0, maxCheck);

  try {
    const queryResult = await compactAdapter.queryFiles(limited);
    return { isDecompressed: isRatioDecompressed(queryResult.ratio), ratio: queryResult.ratio, checkedFiles: limited.length };
  } catch {
    return { isDecompressed: true, ratio: 1.0, checkedFiles: limited.length };
  }
}

export async function verifyDecompressionFiles(
  filePaths: string[],
  compactAdapter: CompactAdapter,
  maxCheck = 200,
): Promise<VerifyResult> {
  if (filePaths.length === 0) {
    return { isDecompressed: true, ratio: 1.0, checkedFiles: 0 };
  }

  const limited = filePaths.slice(0, maxCheck);

  try {
    const queryResult = await compactAdapter.queryFiles(limited);
    return { isDecompressed: isRatioDecompressed(queryResult.ratio), ratio: queryResult.ratio, checkedFiles: limited.length };
  } catch {
    return { isDecompressed: true, ratio: 1.0, checkedFiles: limited.length };
  }
}
