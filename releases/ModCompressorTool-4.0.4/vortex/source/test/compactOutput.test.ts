import { describe, it, expect } from 'vitest';
import {
  parseCompactRatio,
  parseCompactStorageSizes,
  decodeCompactOutput,
  hasCompressedMarkers,
  iterCompactQueryBatches,
} from '../src/compactOutput';

describe('parseCompactRatio', () => {
  it('parses "1.23 to 1" pattern', () => {
    expect(parseCompactRatio('1.23 to 1')).toBe(1.23);
  });

  it('parses "2,50 к 1" (Russian locale) pattern', () => {
    expect(parseCompactRatio('2,50 к 1')).toBe(2.50);
  });

  it('parses "1.0 to 1" pattern', () => {
    expect(parseCompactRatio('1.0 to 1')).toBe(1.0);
  });

  it('returns 1.0 for string without ratio', () => {
    expect(parseCompactRatio('No compression information found')).toBe(1.0);
  });
});

describe('parseCompactStorageSizes', () => {
  it('extracts logical and physical from "N total bytes of data are stored in M bytes"', () => {
    // Real compact.exe /q /s directory-level summary output (Windows 10/11)
    const output = [
      ' Listing C:\\mods\\mod1\\',
      ' New files added to this directory will not be compressed.',
      ' ',
      ' Listing C:\\mods\\mod1\\textures\\',
      ' New files added to this directory will not be compressed.',
      ' ',
      'Of 456 files within 3 directories',
      '50 are compressed and 406 are not compressed.',
      '12345678 total bytes of data are stored in 10000000 bytes.',
      'The compression ratio is 1.23 to 1.',
    ].join('\n');

    const result = parseCompactStorageSizes(output);
    expect(result.logical).toBe(12345678);
    expect(result.physical).toBe(10000000);
  });

  it('handles output with no compressed files', () => {
    const output = [
      ' Listing C:\\mods\\mod2\\',
      ' New files added to this directory will not be compressed.',
      ' ',
      'Of 789 files within 1 directories',
      '0 are compressed and 789 are not compressed.',
      '5000000 total bytes of data are stored in 5000000 bytes.',
      'The compression ratio is 1.0 to 1.',
    ].join('\n');

    const result = parseCompactStorageSizes(output);
    expect(result.logical).toBe(5000000);
    expect(result.physical).toBe(5000000);
  });

  it('returns {0, 0} for per-file query output with no summary line', () => {
    const output = [
      '   file1.dds: not compressed',
      '   file2.nif: compressed (ratio 1.6 to 1)',
    ].join('\n');

    const result = parseCompactStorageSizes(output);
    expect(result.logical).toBe(0);
    expect(result.physical).toBe(0);
  });
});

describe('decodeCompactOutput', () => {
  it('decodes basic ASCII buffer to string', () => {
    const buf = Buffer.from('Hello compact output', 'utf-8');
    const result = decodeCompactOutput(buf);
    expect(result).toBe('Hello compact output');
  });

  it('decodes cp866 encoded buffer', () => {
    // Russian word "Привет" in cp866 encoding
    const cp866Buf = Buffer.from([
      0x8f, 0xe0, 0xa8, 0xa2, 0xa5, 0xe2, // "Привет" in cp866
    ]);
    const result = decodeCompactOutput(cp866Buf);
    expect(result).toBe('Привет');
  });

  it('falls back to utf-8 with replacement for unknown encoding', () => {
    // Random bytes that shouldn't decode cleanly in any supported encoding
    const buf = Buffer.from([0xff, 0xfe, 0x00, 0x61]);
    const result = decodeCompactOutput(buf);
    expect(typeof result).toBe('string');
  });
});

describe('hasCompressedMarkers', () => {
  it('returns true for line starting with "C "', () => {
    const output = '  C  somefile.dds\n  U  otherfile.nif';
    expect(hasCompressedMarkers(output)).toBe(true);
  });

  it('returns false for output without C markers', () => {
    const output = '  U  somefile.dds\n  U  otherfile.nif';
    expect(hasCompressedMarkers(output)).toBe(false);
  });

  it('returns true for leading C marker', () => {
    const output = 'C  texture.dds';
    expect(hasCompressedMarkers(output)).toBe(true);
  });
});

describe('iterCompactQueryBatches', () => {
  it('splits paths into batches respecting maxChars limit', () => {
    const paths = [
      'C:\\short\\path.dds',
      'C:\\another\\mesh.nif',
    ];

    // Each path is ~24 chars + 3 = 27 char overhead
    // Base "compact.exe /q" is ~13 chars
    // With maxChars=50, first path (13+27=40) fits, second pushes over limit
    const batches = iterCompactQueryBatches(paths, 50);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toEqual(['C:\\short\\path.dds']);
    expect(batches[1]).toEqual(['C:\\another\\mesh.nif']);
  });

  it('keeps multiple paths in one batch when they fit', () => {
    const paths = ['a.dds', 'b.nif'];

    const batches = iterCompactQueryBatches(paths, 100);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it('handles empty input', () => {
    const batches = iterCompactQueryBatches([]);
    expect(batches).toHaveLength(0);
  });
});
