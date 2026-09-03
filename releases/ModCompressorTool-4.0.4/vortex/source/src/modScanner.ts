import * as path from 'path';
import * as fs from 'fs';
import {
  COMPRESSIBLE_EXTENSIONS,
  IGNORE_EXTENSIONS,
  MIN_FILE_SIZE,
  LOD_PATH_INDICATORS,
  LOD_FILENAME_PATTERNS,
  TARGET_DIRS,
  LOD_NESTED_PATHS,
} from './constants';
import { ModInfo, TargetType } from './types';
import { CompactAdapter, QueryResult } from './windowsCompression';

// --- Categorization ---

/**
 * Determine file category based on path and extension.
 * Mirrors the MO2 _get_file_category() function.
 */
export function getFileCategory(filepath: string, ext: string): string {
  const pathLower = filepath.toLowerCase();
  const filename = path.basename(filepath).toLowerCase();

  // Check for LOD path indicators first (they take priority)
  for (const indicator of LOD_PATH_INDICATORS) {
    if (pathLower.includes(indicator.toLowerCase())) {
      return 'lod';
    }
  }

  // Check for LOD filename patterns
  for (const pattern of LOD_FILENAME_PATTERNS) {
    if (pattern.test(filename)) {
      return 'lod';
    }
  }

  // Classify by extension
  if (ext === '.dds' || ext === '.tga' || ext === '.bmp') {
    return 'texture';
  }
  if (ext === '.nif' || ext === '.btr' || ext === '.bto' || ext === '.tri') {
    return 'mesh';
  }
  if (ext === '.lst' || ext === '.btd' || ext === '.lod') {
    return 'lod';
  }
  if (ext === '.hkx' || ext === '.kf') {
    return 'animation';
  }
  // Note: .wav, .xwm handled as 'other' - no separate category for sound in ModInfo
  // but we track sound size via sound dirs

  return 'other';
}

// --- Directory Discovery ---

/**
 * Find target directories within a mod root for the given target types.
 * Mirrors the MO2 _find_target_dirs() function.
 */
export function findTargetDirs(modRoot: string, targets: string[]): string[] {
  if (targets.includes('all')) {
    return [modRoot];
  }

  const result: string[] = [];
  const seen = new Set<string>();

  const roots = [modRoot];
  const dataPath = path.join(modRoot, 'Data');
  if (fs.existsSync(dataPath) && fs.statSync(dataPath).isDirectory()) {
    roots.push(dataPath);
  }

  // Build set of target directory names (lowercased)
  const targetNames = new Set<string>();
  for (const t of targets) {
    const dirs = TARGET_DIRS[t as TargetType] || [];
    for (const d of dirs) {
      targetNames.add(d.toLowerCase());
    }
  }

  // Collect LOD nested paths
  let lodNestedPaths: string[] = [];
  if (targets.includes('lod')) {
    lodNestedPaths = LOD_NESTED_PATHS;
  }

  for (const base of roots) {
    try {
      // Check top-level directories
      const entries = fs.readdirSync(base);
      for (const entry of entries) {
        const entryPath = path.join(base, entry);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(entryPath);
        } catch {
          continue;
        }
        if (!stat.isDirectory()) {
          continue;
        }

        const entryLower = entry.toLowerCase();
        const key = entryPath.toLowerCase();

        if (targetNames.has(entryLower) && !seen.has(key)) {
          seen.add(key);
          result.push(entryPath);
        }
      }

      // Check LOD nested paths
      for (const nested of lodNestedPaths) {
        const nestedPath = path.join(base, nested);
        const nestedKey = nestedPath.toLowerCase();
        if (seen.has(nestedKey)) {
          continue;
        }
        try {
          if (fs.statSync(nestedPath).isDirectory()) {
            seen.add(nestedKey);
            result.push(nestedPath);

            // For terrain dirs, also include worldspace subdirs
            if (nested.toLowerCase().includes('terrain')) {
              try {
                const wsEntries = fs.readdirSync(nestedPath);
                for (const ws of wsEntries) {
                  const wsPath = path.join(nestedPath, ws);
                  const wsKey = wsPath.toLowerCase();
                  if (seen.has(wsKey)) {
                    continue;
                  }
                  try {
                    if (fs.statSync(wsPath).isDirectory()) {
                      seen.add(wsKey);
                      result.push(wsPath);
                    }
                  } catch {
                    // skip
                  }
                }
              } catch {
                // skip
              }
            }
          }
        } catch {
          // path doesn't exist
        }
      }
    } catch {
      // base dir doesn't exist or no access
    }
  }

  return result;
}

// --- Mod Scanning ---

export interface ScanOptions {
  useCompactCheck?: boolean;
  compactAdapter?: CompactAdapter;
  onProgress?: (done: number, total: number) => void;
}

export interface ScanResult {
  info: ModInfo;
  queryResult?: QueryResult;
}

/**
 * Scan a mod directory, categorizing files and detecting compression.
 * Mirrors the MO2 _scan_mod_fast() function but without WinAPI calls.
 */
export async function scanMod(
  modRoot: string,
  options?: ScanOptions,
): Promise<ScanResult> {
  const info: ModInfo = {
    fileCount: 0,
    totalSize: 0,
    diskSize: 0,
    ratio: 1.0,
    compressed: false,
    algorithm: '',
    compressedAt: '',
    scannedAt: new Date().toISOString(),
    skippedFiles: 0,
    textureSize: 0,
    meshSize: 0,
    soundSize: 0,
    lodSize: 0,
    animationSize: 0,
    otherSize: 0,
    compressedByAttr: 0,
    compressedBySize: 0,
    compressedByWof: 0,
  };

  const useCompactCheck = options?.useCompactCheck ?? true;
  let skipped = 0;

  try {
    const entries = gatherFiles(modRoot);

    for (let index = 0; index < entries.length; index++) {
      const filepath = entries[index];
      const ext = path.extname(filepath).toLowerCase();

      try {
        // Skip ignored extensions
        if (IGNORE_EXTENSIONS.has(ext)) {
          skipped++;
          continue;
        }

        const stat = fs.statSync(filepath);
        const logicalSize = stat.size;

        // Skip very small files
        if (logicalSize < MIN_FILE_SIZE) {
          skipped++;
          continue;
        }

        info.fileCount++;
        info.totalSize += logicalSize;

        // Categorize file
        const category = getFileCategory(filepath, ext);
        if (category === 'texture') {
          info.textureSize += logicalSize;
        } else if (category === 'mesh') {
          info.meshSize += logicalSize;
        } else if (category === 'lod') {
          info.lodSize += logicalSize;
        } else if (category === 'sound') {
          info.soundSize += logicalSize;
        } else if (category === 'animation') {
          info.animationSize += logicalSize;
        } else {
          info.otherSize += logicalSize;
        }

      } catch {
        skipped++;
      } finally {
        options?.onProgress?.(index + 1, entries.length);
      }
    }
  } catch {
    // Permission error or other
  }

  info.skippedFiles = skipped;
  info.scannedAt = new Date().toISOString();

  if (useCompactCheck) {
    const adapter = options?.compactAdapter ?? new CompactAdapter();
    try {
      const queryResult = await adapter.query(modRoot);
      info.compressed = queryResult.compressed;
      info.ratio = queryResult.ratio;

      if (queryResult.sizes && queryResult.sizes.logical > 0 && queryResult.sizes.physical > 0) {
        // Use compact.exe's own size report (same as compressionService.compressMod)
        info.totalSize = queryResult.sizes.logical;
        info.diskSize = queryResult.sizes.physical;
      }

      return { info, queryResult };
    } catch {
      // compact query failed
    }
  }

  // Fallback: estimate ratio from total size
  if (info.diskSize <= 0) {
    info.diskSize = info.totalSize;
  }
  if (info.totalSize > 0 && info.diskSize > 0) {
    info.ratio = info.totalSize / info.diskSize;
  }

  return { info };
}

/**
 * Recursively gather all file paths under a root directory.
 * Skips hidden dirs and symlinks/junctions.
 */
function gatherFiles(root: string): string[] {
  const result: string[] = [];
  const queue = [root];

  while (queue.length > 0) {
    const dir = queue.pop()!;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dir, entry);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isSymbolicLink()) {
        continue;
      }

      if (stat.isDirectory()) {
        // Check if it's a junction (reparse point)
        // Node doesn't expose isJunction directly, but we skip reparse points
        try {
          if (isJunction(fullPath)) {
            continue;
          }
        } catch {
          // skip
        }
        queue.push(fullPath);
      } else if (stat.isFile()) {
        result.push(fullPath);
      }
    }
  }

  return result;
}

/**
 * Check if a path is a junction/reparse point.
 */
function isJunction(filepath: string): boolean {
  try {
    const stat = fs.lstatSync(filepath);
    // On Windows, junctions and symlinks have isSymbolicLink() = false
    // but are reparse points. We can detect by checking if a directory
    // has the same inode for both parent and target.
    if (!stat.isDirectory()) {
      return false;
    }

    // Best-effort: read the real path and compare
    try {
      const real = fs.realpathSync(filepath);
      return real.toLowerCase() !== filepath.toLowerCase();
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}
