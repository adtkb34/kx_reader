/**
 * ```openapi fence → placeholder HTML for compact API view mount.
 *
 * Line 1: assets/...yaml|.json  OR  https://...  OR  start of inline OpenAPI
 * Line 2 (file/url mode, optional): caption
 *
 * Inline mode: fence body is the full OpenAPI YAML/JSON (starts with openapi:/swagger:/{).
 * Client fetches/parses and mounts a book-style ops list into `.openapi-embed-mount`
 * (see client/src/openapiEmbed.ts). Not Redoc / Swagger UI.
 *
 * Must start with `<pre` so markdown-it does not wrap again (same as figma), and only
 * use phrasing children (`span`) so DOMParser / hang-off extract keeps the node.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toBase64Utf8(s: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(s, 'utf8').toString('base64');
  }
  // Browser-safe path (not expected in shared markdown render, but keep portable).
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function errorHtml(message: string): string {
  return (
    `<pre class="openapi-embed openapi-embed-error">` +
    `<span>${esc(message)}</span>` +
    `</pre>`
  );
}

function looksLikeInlineSpec(firstLine: string): boolean {
  const t = firstLine.trim();
  return (
    /^(openapi|swagger)\s*:/i.test(t) ||
    t.startsWith('{') ||
    t.startsWith('---')
  );
}

function looksLikeSpecRef(firstLine: string): boolean {
  const t = firstLine.trim();
  if (!t) return false;
  if (/^https?:\/\//i.test(t)) return true;
  if (/\.(ya?ml|json)(\?.*)?$/i.test(t)) return true;
  if (/^(?:\.\/)?assets\//i.test(t)) return true;
  return false;
}

function embedHtml(attrs: string, caption: string): string {
  const captionHtml = caption
    ? `<span class="openapi-embed-caption">${esc(caption)}</span>`
    : '';
  // Start with <pre so markdown-it fence does not wrap again (same as figma).
  return (
    `<pre class="openapi-embed" data-zoomable="openapi"${attrs}>` +
    captionHtml +
    `<span class="openapi-embed-mount"></span>` +
    `</pre>`
  );
}

export function renderOpenApiEmbed(source: string): string {
  const body = source.replace(/\r\n/g, '\n').trim();
  if (!body) return errorHtml('缺少 OpenAPI 规范：写 assets/…yaml 路径，或内联 openapi: 3.x');

  const lines = body.split('\n');
  const first = (lines[0] ?? '').trim();

  if (looksLikeSpecRef(first) && !looksLikeInlineSpec(first)) {
    const caption = (lines[1] ?? '').trim();
    const isUrl = /^https?:\/\//i.test(first);
    const pathAttr = isUrl ? '' : ` data-spec-path="${esc(first.replace(/^\.\//, ''))}"`;
    const urlAttr = isUrl ? ` data-spec-url="${esc(first)}"` : '';
    const title = caption || 'OpenAPI';
    return embedHtml(`${pathAttr}${urlAttr} data-title="${esc(title)}"`, caption);
  }

  if (!looksLikeInlineSpec(first) && !looksLikeInlineSpec(body)) {
    return errorHtml(
      '无法识别 OpenAPI 内容：首行应为 assets/…yaml、https://… 或 openapi:/swagger: 内联规范',
    );
  }

  return embedHtml(` data-spec-b64="${toBase64Utf8(body)}" data-title="OpenAPI"`, '');
}
