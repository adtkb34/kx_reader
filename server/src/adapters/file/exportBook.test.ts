import { describe, expect, it } from 'vitest';
import { fileBookRepository } from './bookRepository';
import { exportBookDigest } from './exportBook';

describe('exportBookDigest', () => {
  it('assembles the sample lenses page', async () => {
    const bundle = await exportBookDigest(fileBookRepository, 'sample', {
      modules: 'lenses',
      read: 'scenario',
    });
    expect(bundle).not.toBeNull();
    const result = bundle!.payload;
    expect(result.bookId).toBe('sample');
    expect(result.focusModuleIds).toEqual(['lenses']);
    expect(result.chapterIds).toEqual(['lenses']);
    expect(result.selection).toEqual({ read: ['scenario'] });
    expect(result.markdown).toContain('导出接口');
    expect(result.filename).toMatch(/阅读透镜/);
    expect(result.filename).toMatch(/\.md$/);
    expect(result.assets).toEqual([]);
  });

  it('packs referenced sample photos into a zip', async () => {
    const bundle = await exportBookDigest(fileBookRepository, 'sample', {
      modules: 'format',
      read: 'impl',
    });
    expect(bundle).not.toBeNull();
    const { payload, zipBytes } = bundle!;
    expect(payload.assets.map((a) => a.path)).toContain('assets/photo-demo.png');
    expect(payload.zipFilename).toMatch(/\.zip$/);
    expect(zipBytes[0]).toBe(0x50);
    expect(zipBytes[1]).toBe(0x4b);
    const ascii = Buffer.from(zipBytes).toString('latin1');
    expect(ascii).toContain('assets/photo-demo.png');
  });

  it('embeds images as data URIs when images=embed', async () => {
    const bundle = await exportBookDigest(fileBookRepository, 'sample', {
      modules: 'format',
      read: 'impl',
      images: 'embed',
    });
    expect(bundle?.payload.markdown).toMatch(/!\[[^\]]*\]\(data:image\/png;base64,/);
    expect(bundle?.payload.assets[0]?.base64).toBeTruthy();
  });

  it('returns null for a missing book', async () => {
    expect(await exportBookDigest(fileBookRepository, 'no-such-book', {})).toBeNull();
  });
});
