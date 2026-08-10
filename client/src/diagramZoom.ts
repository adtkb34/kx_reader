/** Find a zoomable diagram root under a click target. */
export function diagramZoomTarget(el: EventTarget | null): HTMLElement | null {
  if (!(el instanceof Element)) return null;
  const mermaid = el.closest('.mermaid-wrap.is-rendered');
  if (mermaid instanceof HTMLElement && mermaid.querySelector('svg')) return mermaid;
  const screen = el.closest('.screen-ui:not(.screen-ui-error)');
  if (screen instanceof HTMLElement) return screen;
  const wireframe = el.closest('.wireframe');
  if (wireframe instanceof HTMLElement) return wireframe;
  return null;
}

/** HTML snapshot for the lightbox (SVG for mermaid, full node for wireframe). */
export function cloneDiagramHtml(source: HTMLElement): string {
  if (source.classList.contains('mermaid-wrap')) {
    const svg = source.querySelector('svg');
    if (svg) {
      const clone = svg.cloneNode(true) as SVGElement;
      clone.removeAttribute('style');
      clone.style.maxWidth = 'none';
      clone.style.width = 'auto';
      clone.style.height = 'auto';
      clone.style.display = 'block';
      clone.style.margin = '0 auto';
      return clone.outerHTML;
    }
  }
  return source.outerHTML;
}
