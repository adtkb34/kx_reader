/**
 * Mount compact OpenAPI view into ```openapi placeholders (no Redoc).
 */

import { parse as parseYaml } from 'yaml';
import { renderOpenApiView, type OpenApiSpec } from '@shared/openapiView';

const MOUNTED = 'data-openapi-mounted';
const waiters = new WeakMap<HTMLElement, () => void>();

function decodeSpecB64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function resolveSpecUrl(embed: HTMLElement, bookId: string): string | null {
  const remote = embed.getAttribute('data-spec-url')?.trim();
  if (remote) return remote;
  const path = embed.getAttribute('data-spec-path')?.trim();
  if (!path) return null;
  const cleaned = path.replace(/^\.\//, '');
  if (cleaned.startsWith('assets/')) {
    return `/api/books/${encodeURIComponent(bookId)}/${cleaned}`;
  }
  return `/api/books/${encodeURIComponent(bookId)}/assets/${cleaned.replace(/^assets\//, '')}`;
}

function parseSpecText(text: string): OpenApiSpec {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('空规范');
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as OpenApiSpec;
  return parseYaml(trimmed) as OpenApiSpec;
}

function markError(embed: HTMLElement, message: string): void {
  disposeWaiter(embed);
  embed.classList.remove('is-loading');
  embed.classList.add('openapi-embed-error');
  embed.replaceChildren();
  const span = document.createElement('span');
  span.textContent = message;
  embed.append(span);
}

function disposeWaiter(embed: HTMLElement): void {
  waiters.get(embed)?.();
  waiters.delete(embed);
}

async function loadSpecText(embed: HTMLElement, bookId: string): Promise<string> {
  const b64 = embed.getAttribute('data-spec-b64')?.trim();
  if (b64) return decodeSpecB64(b64);
  const url = resolveSpecUrl(embed, bookId);
  if (!url) throw new Error('缺少 OpenAPI 规范路径或内容');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`规范拉取失败 HTTP ${res.status}`);
  return res.text();
}

async function mountEmbed(embed: HTMLElement, bookId: string): Promise<void> {
  if (
    embed.classList.contains('openapi-embed-error') ||
    embed.getAttribute(MOUNTED) === '1' ||
    embed.classList.contains('is-loading')
  ) {
    return;
  }
  const mount = embed.querySelector<HTMLElement>('.openapi-embed-mount');
  if (!mount) {
    markError(embed, 'OpenAPI 占位缺少 .openapi-embed-mount');
    return;
  }

  embed.classList.add('is-loading');
  let cancelled = false;
  waiters.set(embed, () => {
    cancelled = true;
  });

  try {
    const text = await loadSpecText(embed, bookId);
    if (cancelled) return;
    const spec = parseSpecText(text);
    mount.innerHTML = renderOpenApiView(spec);
    embed.setAttribute(MOUNTED, '1');
    embed.classList.remove('is-loading');
    embed.classList.add('is-ready');
  } catch (e) {
    if (cancelled) return;
    const msg = e instanceof Error ? e.message : String(e);
    markError(embed, `OpenAPI 渲染失败：${msg}`);
  } finally {
    waiters.delete(embed);
  }
}

export function activateOpenApiEmbedsIn(
  root: HTMLElement | null,
  bookId: string,
): void {
  if (!root || !bookId) return;
  root
    .querySelectorAll<HTMLElement>(
      `.openapi-embed:not(.openapi-embed-error):not([${MOUNTED}="1"])`,
    )
    .forEach((embed) => {
      void mountEmbed(embed, bookId);
    });
}

export function disposeOpenApiEmbedsIn(root: HTMLElement | null): void {
  if (!root) return;
  root.querySelectorAll<HTMLElement>('.openapi-embed').forEach((embed) => {
    disposeWaiter(embed);
  });
}

export function bindOpenApiEmbedDetails(
  root: HTMLElement | null,
  bookId: string,
): () => void {
  if (!root) return () => {};
  const onToggle = (e: Event) => {
    const details = e.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;
    activateOpenApiEmbedsIn(details, bookId);
  };
  root.addEventListener('toggle', onToggle, true);
  return () => {
    root.removeEventListener('toggle', onToggle, true);
    disposeOpenApiEmbedsIn(root);
  };
}
