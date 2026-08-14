import { describe, expect, it } from 'vitest';
import {
  bookAssetRelPath,
  bytesToBase64,
  collectMarkdownAssetPaths,
  embedAssetsInMarkdown,
  normalizeBookAssetPath,
} from './exportAssets';

describe('normalizeBookAssetPath', () => {
  it('accepts book-relative image paths', () => {
    expect(normalizeBookAssetPath('assets/photo-demo.png')).toBe('assets/photo-demo.png');
    expect(normalizeBookAssetPath('./assets/a.JPG')).toBe('assets/a.JPG');
    expect(normalizeBookAssetPath('/api/books/sample/assets/quality/a.webp')).toBe(
      'assets/quality/a.webp',
    );
  });

  it('rejects non-images and escapes', () => {
    expect(normalizeBookAssetPath('assets/openapi/api.yaml')).toBeNull();
    expect(normalizeBookAssetPath('https://example.com/a.png')).toBeNull();
    expect(normalizeBookAssetPath('assets/../secret.png')).toBeNull();
  });
});

describe('collectMarkdownAssetPaths', () => {
  it('picks markdown and html images, unique order', () => {
    const md = `
![登录](assets/screenshots/login.jpg "登录页")
![](./assets/screenshots/login.jpg)
<img src="assets/other.png" alt="x" />
![跳过](https://cdn.example/a.png)
`;
    expect(collectMarkdownAssetPaths(md)).toEqual([
      'assets/screenshots/login.jpg',
      'assets/other.png',
    ]);
    expect(bookAssetRelPath('assets/screenshots/login.jpg')).toBe('screenshots/login.jpg');
  });
});

describe('embedAssetsInMarkdown', () => {
  it('inlines matching images as data URIs', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const md = '![样例](assets/photo-demo.png)\n';
    const out = embedAssetsInMarkdown(
      md,
      new Map([['assets/photo-demo.png', { contentType: 'image/png', bytes }]]),
    );
    expect(out).toBe(`![样例](data:image/png;base64,${bytesToBase64(bytes)})\n`);
  });
});
