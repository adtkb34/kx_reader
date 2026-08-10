/**
 * Watch ```figma embeds: network fetch starts with HTML src; we only reveal
 * after Figma is ready. Prefer INITIAL_LOAD; fall back shortly after shell load.
 * Also warm embeds inside closed <details> so opening them feels instant.
 */

import { figmaMessageType } from '@shared/figmaEmbed';

const FIGMA_ORIGINS = new Set([
  'https://www.figma.com',
  'https://embed.figma.com',
]);

const READY_EVENTS = new Set([
  'INITIAL_LOAD',
  'EMBED_LOADED',
  'INITIAL_LOAD_COMPLETE',
  'PRESENTED_NODE_CHANGED',
]);

/** Short settle after a ready event (first paint). */
const SETTLE_MS = 120;
/** Soft reveal if Embed API events never arrive after shell load. */
const LOAD_FALLBACK_MS = 900;
const READY_TIMEOUT_MS = 25_000;

const waiters = new WeakMap<HTMLElement, () => void>();

function openInFigmaUrl(embedSrc: string): string {
  return embedSrc.replace('https://embed.figma.com/', 'https://www.figma.com/') || embedSrc;
}

function disposeWaiter(embed: HTMLElement): void {
  waiters.get(embed)?.();
  waiters.delete(embed);
}

function markReady(embed: HTMLElement): void {
  disposeWaiter(embed);
  embed.classList.remove('is-loading');
  embed.classList.add('is-ready');
}

function markFailed(embed: HTMLElement, openUrl: string): void {
  disposeWaiter(embed);
  embed.classList.remove('is-loading');
  embed.classList.add('figma-embed-error');
  embed.replaceChildren();
  const span = document.createElement('span');
  span.append('原型加载较慢或未完成，可');
  const a = document.createElement('a');
  a.href = openUrl;
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.textContent = '在 Figma 中打开';
  span.append(a);
  embed.append(span);
}

function watchEmbed(embed: HTMLElement): void {
  if (
    embed.classList.contains('figma-embed-error') ||
    embed.classList.contains('is-ready') ||
    embed.classList.contains('is-loading')
  ) {
    return;
  }
  const iframe = embed.querySelector('iframe');
  if (!(iframe instanceof HTMLIFrameElement)) return;
  const src =
    iframe.getAttribute('data-src')?.trim() ||
    iframe.getAttribute('src')?.trim();
  if (!src) return;

  embed.classList.add('is-loading');

  let settled = false;
  let settleTimer = 0;
  let loadFallbackTimer = 0;

  const finish = () => {
    if (settled) return;
    settled = true;
    if (settleTimer) window.clearTimeout(settleTimer);
    if (loadFallbackTimer) window.clearTimeout(loadFallbackTimer);
    markReady(embed);
  };

  const scheduleFinish = (delayMs: number) => {
    if (settled) return;
    if (settleTimer) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(finish, delayMs);
  };

  const onMessage = (event: MessageEvent) => {
    if (!FIGMA_ORIGINS.has(event.origin)) return;
    if (event.source !== iframe.contentWindow) return;
    const type = figmaMessageType(event.data);
    if (!type) return;

    if (type === 'LOGIN_SCREEN_SHOWN') {
      markFailed(embed, openInFigmaUrl(src));
      return;
    }

    if (!READY_EVENTS.has(type)) return;
    if (loadFallbackTimer) {
      window.clearTimeout(loadFallbackTimer);
      loadFallbackTimer = 0;
    }
    scheduleFinish(SETTLE_MS);
  };

  const onShellLoad = () => {
    if (settled || settleTimer) return;
    loadFallbackTimer = window.setTimeout(finish, LOAD_FALLBACK_MS);
  };

  const timeout = window.setTimeout(() => {
    if (settled) return;
    markFailed(embed, openInFigmaUrl(src));
  }, READY_TIMEOUT_MS);

  window.addEventListener('message', onMessage);
  // Shell may already have loaded before we attach (src was in HTML).
  try {
    if (iframe.contentDocument?.readyState === 'complete') {
      onShellLoad();
    } else {
      iframe.addEventListener('load', onShellLoad, { once: true });
    }
  } catch {
    // Cross-origin: contentDocument throws — rely on load event.
    iframe.addEventListener('load', onShellLoad, { once: true });
  }

  waiters.set(embed, () => {
    window.removeEventListener('message', onMessage);
    iframe.removeEventListener('load', onShellLoad);
    window.clearTimeout(timeout);
    if (settleTimer) window.clearTimeout(settleTimer);
    if (loadFallbackTimer) window.clearTimeout(loadFallbackTimer);
  });

  // Ensure fetch is running (HTML usually already set src).
  if (!iframe.getAttribute('src')) iframe.src = src;
}

/**
 * Watch every pending Figma embed under root — including those inside closed
 * details — so Figma can warm in the background.
 */
export function activateFigmaEmbedsIn(root: HTMLElement | null): void {
  if (!root) return;
  root
    .querySelectorAll<HTMLElement>('pre.figma-embed:not(.figma-embed-error):not(.is-ready)')
    .forEach((embed) => watchEmbed(embed));
}

export function disposeFigmaEmbedsIn(root: HTMLElement | null): void {
  if (!root) return;
  root.querySelectorAll<HTMLElement>('pre.figma-embed').forEach((embed) => {
    disposeWaiter(embed);
  });
}

/** Re-check on details open (mostly for embeds inserted after first pass). */
export function bindFigmaEmbedDetails(root: HTMLElement | null): () => void {
  if (!root) return () => {};
  const onToggle = (e: Event) => {
    const details = e.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;
    activateFigmaEmbedsIn(details);
  };
  root.addEventListener('toggle', onToggle, true);
  return () => {
    root.removeEventListener('toggle', onToggle, true);
    disposeFigmaEmbedsIn(root);
  };
}
