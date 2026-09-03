import { describe, it, expect } from 'vitest';
import { formatSize, formatRatio, getContentTags, nowISO } from '../src/format';

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    const result = formatSize(2048);
    expect(result).toMatch(/2\.00\s+KB/);
  });

  it('formats megabytes', () => {
    const result = formatSize(1048576);
    expect(result).toMatch(/1\.00\s+MB/);
  });

  it('formats gigabytes', () => {
    const result = formatSize(1073741824);
    expect(result).toMatch(/1\.00\s+GB/);
  });
});

describe('formatRatio', () => {
  it('formats ratio', () => {
    expect(formatRatio(1.5)).toBe('1.50x');
    expect(formatRatio(2.0)).toBe('2.00x');
  });
});

describe('getContentTags', () => {
  it('returns TEX tag for large texture size', () => {
    const tags = getContentTags({
      textureSize: 2 * 1024 * 1024,
      meshSize: 0,
      lodSize: 0,
      animationSize: 0,
      soundSize: 0,
    });
    expect(tags).toContain('TEX');
    expect(tags).not.toContain('MESH');
  });

  it('returns MESH tag for large mesh size', () => {
    const tags = getContentTags({
      textureSize: 0,
      meshSize: 1024 * 1024,
      lodSize: 0,
      animationSize: 0,
      soundSize: 0,
    });
    expect(tags).toContain('MESH');
  });

  it('returns LOD tag for large lod size', () => {
    const tags = getContentTags({
      textureSize: 0,
      meshSize: 0,
      lodSize: 512 * 1024,
      animationSize: 0,
      soundSize: 0,
    });
    expect(tags).toContain('LOD');
  });

  it('returns ISO-formatted date string', () => {
    const result = nowISO();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('returns empty array for small sizes', () => {
    const tags = getContentTags({
      textureSize: 100,
      meshSize: 100,
      lodSize: 100,
      animationSize: 100,
      soundSize: 100,
    });
    expect(tags).toEqual([]);
  });
});
