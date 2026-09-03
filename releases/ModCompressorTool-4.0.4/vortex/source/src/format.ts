/**
 * Format a byte size into a human-readable string.
 * Matches the original MO2 plugin's _format_size().
 */
export function formatSize(bytes: number): string {
  if (bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const factor = 1024;
  let value = bytes;
  let unitIndex = 0;

  while (value >= factor && unitIndex < units.length - 1) {
    value /= factor;
    unitIndex++;
  }

  if (unitIndex === 0) {
    return `${bytes} B`;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Format a ratio for display (e.g. "1.23x").
 */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}x`;
}

/**
 * Format an ISO date string for display.
 */
export function formatDate(isoString: string): string {
  if (!isoString) {
    return '—';
  }
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return isoString;
  }
}

/**
 * Return current timestamp as ISO string.
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Generate content type tags for a mod's scan result.
 */
export function getContentTags(info: {
  textureSize: number;
  meshSize: number;
  lodSize: number;
  animationSize: number;
  soundSize: number;
}): string[] {
  const tags: string[] = [];
  if (info.textureSize > 1024 * 1024) {
    tags.push('TEX');
  }
  if (info.meshSize > 512 * 1024) {
    tags.push('MESH');
  }
  if (info.lodSize > 256 * 1024) {
    tags.push('LOD');
  }
  if (info.animationSize > 256 * 1024) {
    tags.push('ANIM');
  }
  if (info.soundSize > 512 * 1024) {
    tags.push('SND');
  }
  return tags;
}
