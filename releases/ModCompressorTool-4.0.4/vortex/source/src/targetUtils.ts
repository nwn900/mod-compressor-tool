import * as path from 'path';
import { TARGET_DIRS, LOD_NESTED_PATHS } from './constants';
import { TargetType } from './types';

/**
 * Check if a relative path matches one of the given target types.
 * Mirrors the MO2 _matches_target_path() function.
 */
export function matchesTargetPath(relPath: string, targets: string[]): boolean {
  const relNorm = relPath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

  if (!relNorm) {
    return false;
  }

  if (targets.includes('all')) {
    return true;
  }

  // Collect all directory prefixes for the given targets
  const prefixes = new Set<string>();
  for (const target of targets) {
    const dirs = TARGET_DIRS[target as TargetType] ?? [];
    for (const dir of dirs) {
      prefixes.add(dir.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, ''));
    }
  }

  // Add LOD nested paths when LOD target is included
  if (targets.includes('lod')) {
    for (const nestedPath of LOD_NESTED_PATHS) {
      prefixes.add(nestedPath.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, ''));
    }
  }

  for (const prefix of prefixes) {
    if (relNorm === prefix || relNorm.startsWith(prefix + '/')) {
      return true;
    }
  }

  return false;
}

/**
 * Filter a list of file paths to only those matching the given targets.
 * Mirrors the MO2 _filter_file_paths_for_targets() function.
 */
export function filterFilePathsByTarget(
  filePaths: string[],
  baseRoot: string,
  targets: string[],
): string[] {
  if (targets.includes('all')) {
    return [...new Set(filePaths)];
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const fullPath of filePaths) {
    let relPath: string;
    try {
      relPath = path.relative(baseRoot, fullPath);
    } catch {
      relPath = path.basename(fullPath);
    }

    if (!matchesTargetPath(relPath, targets)) {
      continue;
    }

    const key = fullPath.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(fullPath);
    }
  }

  return result;
}
