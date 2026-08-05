import type Mermaid from 'mermaid';

let mermaidReady: Promise<typeof Mermaid> | null = null;
let seq = 0;

function getMermaid(): Promise<typeof Mermaid> {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        // strict 会剥掉节点里的 HTML（如 <br/>），图看起来像坏了；内容来自本站 Markdown，用 antiscript 即可
        securityLevel: 'antiscript',
        theme: 'base',
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
        themeVariables: {
          background: '#ffffff',
          primaryColor: '#e8eef9',
          primaryTextColor: '#1f2937',
          primaryBorderColor: '#93b4f5',
          secondaryColor: '#f5f2ec',
          secondaryTextColor: '#1f2937',
          secondaryBorderColor: '#d8d4ca',
          tertiaryColor: '#faf8f4',
          tertiaryTextColor: '#1f2937',
          tertiaryBorderColor: '#e5e2da',
          lineColor: '#8b8680',
          textColor: '#1f2937',
          mainBkg: '#e8eef9',
          nodeBorder: '#93b4f5',
          clusterBkg: '#faf8f4',
          clusterBorder: '#e5e2da',
          titleColor: '#374151',
          edgeLabelBackground: '#ffffff',
          fontSize: '14px',
        },
        flowchart: {
          htmlLabels: true,
          curve: 'basis',
          padding: 18,
          nodeSpacing: 40,
          rankSpacing: 50,
          diagramPadding: 12,
        },
        sequence: {
          actorMargin: 48,
          messageMargin: 36,
          mirrorActors: false,
        },
      });
      return mermaid;
    });
  }
  return mermaidReady;
}

function isVisible(el: HTMLElement): boolean {
  const details = el.closest('details');
  return !details || details.open;
}

/** Prefer intrinsic size over mermaid's width="100%" (avoids huge empty frames). */
function normalizeMermaidSvg(svg: SVGElement): void {
  const raw = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  // viewBox may use a negative origin (e.g. "-4 -4 152 509"); only width/height must be > 0
  if (raw && raw.length === 4 && raw.every((n) => Number.isFinite(n))) {
    const w = raw[2]!;
    const h = raw[3]!;
    if (w > 0 && h > 0) {
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
    }
  } else if (svg.getAttribute('width') === '100%') {
    svg.removeAttribute('width');
  }
  svg.style.maxWidth = '100%';
  svg.style.height = 'auto';
  svg.style.width = 'auto';
}

/**
 * 渲染 root 内尚未处理的 Mermaid 图。
 * 折叠块内的图只在展开后渲染，避免尺寸为 0。
 */
export async function renderMermaidIn(root: HTMLElement | null): Promise<void> {
  if (!root) return;
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>('pre.mermaid:not([data-processed])'),
  ).filter(isVisible);
  if (candidates.length === 0) return;

  const mermaid = await getMermaid();
  for (const node of candidates) {
    if (!node.id) node.id = `mmd-${++seq}`;
  }

  try {
    await mermaid.run({ nodes: candidates });
    for (const node of candidates) {
      const svg = node.querySelector('svg');
      if (svg) {
        normalizeMermaidSvg(svg);
        node.closest('.mermaid-wrap')?.classList.add('is-rendered');
      }
    }
  } catch (err) {
    console.error('[mermaid] render failed', err);
    for (const node of candidates) {
      if (!node.getAttribute('data-processed') || !node.querySelector('svg')) {
        node.classList.add('mermaid-error');
        node.setAttribute('data-processed', 'error');
      } else {
        node.closest('.mermaid-wrap')?.classList.add('is-rendered');
      }
    }
  }
}

/** 监听折叠块展开，延迟渲染内部的图 */
export function bindMermaidDetails(root: HTMLElement | null): () => void {
  if (!root) return () => {};
  const onToggle = (e: Event) => {
    const details = e.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;
    void renderMermaidIn(details);
  };
  root.addEventListener('toggle', onToggle, true);
  return () => root.removeEventListener('toggle', onToggle, true);
}
