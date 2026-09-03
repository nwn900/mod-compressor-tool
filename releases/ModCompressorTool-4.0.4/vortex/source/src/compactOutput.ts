/**
 * Parse compact.exe output to extract compression ratio.
 * Handles English ("1.23 to 1") and Russian ("2,50 к 1") locale formats.
 */
/**
 * Extract logical and physical byte sizes from compact.exe /q /s directory-level output.
 * Targets the global summary line:
 *   "N total bytes of data are stored in M bytes."
 * Falls back to returning {0, 0} if the summary line isn't present
 * (per-file query output has no summary).
 */
export function parseCompactStorageSizes(output: string): { logical: number; physical: number } {
  const result = parseCompressOutputSizes(output);
  if (result) {
    return result;
  }
  return { logical: 0, physical: 0 };
}

import * as iconv from 'iconv-lite';
import * as path from 'path';

/**
 * Try decoding a Buffer with cp866, cp1251, then utf-8 encodings.
 * Falls back to utf-8 with replacement characters.
 */
export function decodeCompactOutput(data: Buffer): string {
  const encodings = ['cp866', 'cp1251', 'utf-8'];
  for (const enc of encodings) {
    try {
      const decoded = iconv.decode(data, enc);
      if (decoded) {
        return decoded;
      }
    } catch {
      continue;
    }
  }
  return data.toString('utf-8');
}

/**
 * Check if any line in output starts with "C " (compressed marker).
 */
export function hasCompressedMarkers(output: string): boolean {
  return /^\s*C\s/m.test(output);
}

/**
 * Batch file paths for compact.exe /q queries to avoid Windows command line length limits.
 * Default maxChars ~28000 to stay under the ~32K char limit.
 */
export function iterCompactQueryBatches(filePaths: string[], maxChars = 28000): string[][] {
  const baseChars = 'compact.exe /q'.length;
  const batches: string[][] = [];
  let batch: string[] = [];
  let totalChars = baseChars;

  for (const fp of filePaths) {
    if (!fp) {
      continue;
    }

    const normalized = path.normalize(fp);
    const pathChars = normalized.length + 3;

    if (batch.length > 0 && totalChars + pathChars > maxChars) {
      batches.push(batch);
      batch = [normalized];
      totalChars = baseChars + pathChars;
      continue;
    }

    batch.push(normalized);
    totalChars += pathChars;
  }

  if (batch.length > 0) {
    batches.push(batch);
  }

  return batches;
}

/**
 * Extract logical/physical sizes from compress/decompress stdout.
 * Parses the "N total bytes of data are stored in M bytes" line.
 * Strips all non-digit chars from each side — immune to locale encoding issues.
 */
export function parseCompressOutputSizes(output: string): { logical: number; physical: number } | null {
  for (const line of output.split('\n')) {
    const lower = line.toLowerCase();
    const totalIdx = lower.indexOf('total bytes');
    if (totalIdx < 0) continue;

    const storedIdx = lower.indexOf('stored in', totalIdx);
    if (storedIdx < 0) continue;

    const beforePart = line.substring(0, totalIdx);
    const afterPart = line.substring(storedIdx + 'stored in'.length);

    const logical = parseInt(beforePart.replace(/\D/g, ''), 10) || 0;
    const physical = parseInt(afterPart.replace(/\D/g, ''), 10) || 0;

    if (logical > 0 && physical > 0) {
      return { logical, physical };
    }
  }
  return null;
}

export function parseCompactRatio(output: string): number {
  const patterns = [
    /(\d+[.,]\d+)\s*(?:to|:|\s)\s*1/i,
    /(\d+[.,]\d+)\s*к\s*1/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(output);
    if (match) {
      const normalized = match[1].replace(',', '.');
      return parseFloat(normalized);
    }
  }

  return 1.0;
}
