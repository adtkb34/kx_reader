/**
 * ```figma fence → HTML embed for public Figma prototypes.
 *
 * Line 1: proto URL (www/figma/embed.figma.com)
 * Line 2 (optional): caption
 *
 * iframe gets src immediately so the browser starts fetching Figma ASAP.
 * The client keeps the frame hidden until Figma signals ready (or a short
 * post-shell fallback), so users never see an empty bordered box.
 */

const EMBED_HOST = 'kx-reader';
const ALLOWED_HOSTS = new Set(['www.figma.com', 'figma.com', 'embed.figma.com']);

/** Normalize Figma postMessage payloads (plain string or `{ type }`). */
export function figmaMessageType(data: unknown): string | null {
  if (typeof data === 'string') {
    const t = data.trim();
    return t || null;
  }
  if (data && typeof data === 'object' && 'type' in data) {
    const t = (data as { type: unknown }).type;
    return typeof t === 'string' ? t : null;
  }
  return null;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function errorHtml(message: string, rawUrl?: string): string {
  const link =
    rawUrl && /^https?:\/\//i.test(rawUrl)
      ? ` <a href="${esc(rawUrl)}" target="_blank" rel="noreferrer">${esc(rawUrl)}</a>`
      : '';
  return (
    `<pre class="figma-embed figma-embed-error">` +
    `<span>${esc(message)}${link}</span>` +
    `</pre>`
  );
}

/** Turn a Figma proto URL into an Embed Kit 2.0 src with embed-host. */
export function toFigmaEmbedSrc(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'proto' || !parts[1]) return null;

  const embed = new URL(`https://embed.figma.com${url.pathname}`);
  url.searchParams.forEach((value, key) => {
    if (key === 'embed-host' || key === 'embed_host') return;
    embed.searchParams.set(key, value);
  });
  embed.searchParams.set('embed-host', EMBED_HOST);
  // Less chrome → fewer assets to download; authors can override.
  if (!embed.searchParams.has('footer')) {
    embed.searchParams.set('footer', 'false');
  }
  if (!embed.searchParams.has('device-frame')) {
    embed.searchParams.set('device-frame', 'false');
  }
  return embed.toString();
}

export function renderFigmaEmbed(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').trim().split('\n');
  const rawUrl = (lines[0] ?? '').trim();
  const caption = (lines[1] ?? '').trim();

  if (!rawUrl) {
    return errorHtml('缺少 Figma 原型链接');
  }

  const src = toFigmaEmbedSrc(rawUrl);
  if (!src) {
    return errorHtml('无效的 Figma 原型链接：', rawUrl);
  }

  const title = caption || 'Figma 原型';
  const captionHtml = caption
    ? `<span class="md-figcaption">${esc(caption)}</span>`
    : '';

  // src immediately → browser begins Figma fetch as soon as HTML is inserted.
  // data-src kept for client open-in-Figma fallback URLs.
  // Start with <pre so markdown-it fence does not wrap again (same as hljs path).
  return (
    `<pre class="figma-embed">` +
    `<iframe src="${esc(src)}" data-src="${esc(src)}" title="${esc(title)}" ` +
    `allowfullscreen loading="eager" fetchpriority="high"></iframe>` +
    captionHtml +
    `</pre>`
  );
}
