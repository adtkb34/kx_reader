/**
 * Find and rewrite book-local images (`assets/…`) in assembled export Markdown.
 */

const IMAGE_EXT_RE = /\.(?:jpg|jpeg|png|webp|gif)$/i;

/** Markdown inline image: ![alt](src) or ![alt](<src> "title"). */
const MD_INLINE_IMAGE_SRC =
  /!\[([^\]]*)\]\(\s*<?\s*([^)\s>]+)\s*(?:"[^"]*"|'[^']*')?\s*>?\s*\)/g.source;
const HTML_IMG_SRC_SRC = /<img\b[^>]*?\bsrc\s*=\s*(["'])([^"']+)\1/gi.source;

function mdInlineImageRe(): RegExp {
  return new RegExp(MD_INLINE_IMAGE_SRC, 'g');
}

function htmlImgSrcRe(): RegExp {
  return new RegExp(HTML_IMG_SRC_SRC, 'gi');
}

function uniquePreserve(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** `assets/foo.png` or null if not a book image. */
export function normalizeBookAssetPath(raw: string): string | null {
  let src = raw.trim();
  if (!src) return null;
  try {
    src = decodeURI(src);
  } catch {
    // keep raw
  }
  src = src.split('#')[0]?.split('?')[0] ?? src;
  src = src.replace(/\\/g, '/').replace(/^\.\//, '');
  const api = src.match(/^\/api\/books\/[^/]+\/assets\/(.+)$/i);
  if (api?.[1]) src = `assets/${api[1]}`;
  if (!src.startsWith('assets/')) return null;
  if (src.includes('..')) return null;
  if (!IMAGE_EXT_RE.test(src)) return null;
  return src;
}

/** Relative path under `assets/` for `resolveBookAsset`. */
export function bookAssetRelPath(assetPath: string): string {
  return assetPath.replace(/^assets\//i, '');
}

export function collectMarkdownAssetPaths(markdown: string): string[] {
  const found: string[] = [];
  const add = (raw: string): void => {
    const path = normalizeBookAssetPath(raw);
    if (path) found.push(path);
  };
  for (const m of markdown.matchAll(mdInlineImageRe())) {
    if (m[2]) add(m[2]);
  }
  for (const m of markdown.matchAll(htmlImgSrcRe())) {
    if (m[2]) add(m[2]);
  }
  return uniquePreserve(found);
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export type EmbeddableAsset = {
  contentType: string;
  bytes: Uint8Array;
};

export function embedAssetsInMarkdown(
  markdown: string,
  files: ReadonlyMap<string, EmbeddableAsset>,
): string {
  const toUri = (assetPath: string): string | null => {
    const file = files.get(assetPath);
    if (!file) return null;
    return `data:${file.contentType};base64,${bytesToBase64(file.bytes)}`;
  };

  let out = markdown.replace(mdInlineImageRe(), (full, alt: string, src: string) => {
    const path = normalizeBookAssetPath(src);
    if (!path) return full;
    const uri = toUri(path);
    if (!uri) return full;
    return `![${alt}](${uri})`;
  });

  out = out.replace(htmlImgSrcRe(), (full, _quote: string, src: string) => {
    const path = normalizeBookAssetPath(src);
    if (!path) return full;
    const uri = toUri(path);
    if (!uri) return full;
    return full.replace(src, uri);
  });

  return out;
}
