import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from './zipStore';

describe('zipStore', () => {
  it('writes a PKZIP with uncompressed entries', () => {
    const data = new TextEncoder().encode('hello');
    const zip = zipStore([
      { name: 'folder/readme.md', data },
      { name: 'folder/assets/a.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
    ]);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    const ascii = Buffer.from(zip).toString('latin1');
    expect(ascii).toContain('folder/readme.md');
    expect(ascii).toContain('folder/assets/a.png');
    expect(ascii).toContain('hello');
    expect(crc32(data)).toBe(0x3610a686);
  });
});
