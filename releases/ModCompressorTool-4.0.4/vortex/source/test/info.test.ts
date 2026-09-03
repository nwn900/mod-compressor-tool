import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Vortex extension metadata', () => {
  const infoPath = path.resolve(__dirname, '..', 'info.json');
  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));

  it('contains the required generic extension metadata fields', () => {
    expect(info).toMatchObject({
      name: 'Mod Compressor',
      author: 'Community',
      version: '1.1.0',
    });
    expect(typeof info.description).toBe('string');
    expect(info.description.length).toBeGreaterThan(0);
  });

  it('uses semantic versioning', () => {
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('does not declare game-extension-only metadata', () => {
    expect(info).not.toHaveProperty('type');
    expect(info).not.toHaveProperty('bundled');
    expect(info).not.toHaveProperty('requiredFiles');
    expect(info).not.toHaveProperty('modId');
    expect(info).not.toHaveProperty('latest');
  });
});
