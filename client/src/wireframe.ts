/**
 * Lightweight UI wireframe DSL → HTML.
 *
 * Lines:
 *   @frame Title          outer device / page chrome title
 *   @bar text             top toolbar row
 *   @menu                 start hover/dropdown panel (until blank/@)
 *   @card Title | action  card with optional trailing action label
 *   @row text             body row inside current card/menu/footer
 *   @btn a · b · c        chip buttons (· separated)
 *   @badge text           pill badge
 *   @footer               footer action area
 *   ---                   soft divider
 *   (plain line)          same as @row
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Block =
  | { kind: 'bar'; text: string }
  | { kind: 'menu'; rows: string[] }
  | { kind: 'card'; title: string; action?: string; rows: string[] }
  | { kind: 'footer'; rows: string[] }
  | { kind: 'divider' };

export function renderWireframe(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let frameTitle = '';
  const blocks: Block[] = [];
  let open: Block | null = null;

  const close = () => {
    if (open) {
      blocks.push(open);
      open = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      close();
      continue;
    }
    if (trimmed === '---') {
      close();
      blocks.push({ kind: 'divider' });
      continue;
    }
    if (trimmed.startsWith('@frame ')) {
      close();
      frameTitle = trimmed.slice(7).trim();
      continue;
    }
    if (trimmed.startsWith('@bar ')) {
      close();
      blocks.push({ kind: 'bar', text: trimmed.slice(5).trim() });
      continue;
    }
    if (trimmed === '@menu') {
      close();
      open = { kind: 'menu', rows: [] };
      continue;
    }
    if (trimmed.startsWith('@card ')) {
      close();
      const rest = trimmed.slice(6).trim();
      const [title, action] = rest.split('|').map((s) => s.trim());
      open = { kind: 'card', title, ...(action ? { action } : {}), rows: [] };
      continue;
    }
    if (trimmed === '@footer') {
      close();
      open = { kind: 'footer', rows: [] };
      continue;
    }
    if (trimmed.startsWith('@btn ')) {
      const text = trimmed.slice(5).trim();
      if (open && (open.kind === 'card' || open.kind === 'footer' || open.kind === 'menu')) {
        open.rows.push(`__btn__${text}`);
      } else {
        close();
        open = { kind: 'footer', rows: [`__btn__${text}`] };
      }
      continue;
    }
    if (trimmed.startsWith('@badge ')) {
      const text = trimmed.slice(7).trim();
      if (open && (open.kind === 'card' || open.kind === 'menu')) {
        open.rows.push(`__badge__${text}`);
      }
      continue;
    }
    if (trimmed.startsWith('@row ')) {
      const text = trimmed.slice(5).trim();
      if (open && (open.kind === 'card' || open.kind === 'menu' || open.kind === 'footer')) {
        open.rows.push(text);
      }
      continue;
    }
    // plain line → row in open block, or ignore
    if (open && (open.kind === 'card' || open.kind === 'menu' || open.kind === 'footer')) {
      open.rows.push(trimmed);
    }
  }
  close();

  const inner = blocks.map(renderBlock).join('');
  const titleHtml = frameTitle
    ? `<div class="wf-frame-title">${esc(frameTitle)}</div>`
    : '';
  return (
    `<div class="wireframe" role="img" aria-label="${esc(frameTitle || 'UI 线框')}">` +
    `<div class="wf-device">` +
    titleHtml +
    `<div class="wf-body">${inner}</div>` +
    `</div></div>`
  );
}

function renderBlock(b: Block): string {
  switch (b.kind) {
    case 'bar':
      return (
        `<div class="wf-bar"><span class="wf-bar-lead">${esc(b.text)}</span>` +
        `<span class="wf-avatar" title="头像"></span></div>`
      );
    case 'menu':
      return (
        `<div class="wf-menu">` +
        b.rows.map(renderRow).join('') +
        `</div>`
      );
    case 'card':
      return (
        `<div class="wf-card">` +
        `<div class="wf-card-head">` +
        `<span class="wf-card-title">${esc(b.title)}</span>` +
        renderCardAction(b.action) +
        `</div>` +
        (b.rows.length
          ? `<div class="wf-card-body">${b.rows.map(renderRow).join('')}</div>`
          : '') +
        `</div>`
      );
    case 'footer':
      return `<div class="wf-footer">${b.rows.map(renderRow).join('')}</div>`;
    case 'divider':
      return `<div class="wf-divider"></div>`;
  }
}

function renderCardAction(action?: string): string {
  if (!action) return '';
  const a = action.trim();
  if (/^\d+$/.test(a)) {
    return `<span class="wf-badge wf-badge-inline">${esc(a)}</span>`;
  }
  if (a === '···' || a === '...' || a === 'more') {
    return `<span class="wf-icon wf-icon-more" title="更多" aria-label="更多">···</span>`;
  }
  if (a === 'edit' || a === '✎' || a === '编辑') {
    return `<span class="wf-icon wf-icon-edit" title="编辑" aria-label="编辑">✎</span>`;
  }
  return `<span class="wf-card-action">${esc(a)}</span>`;
}

function renderRow(row: string): string {
  if (row.startsWith('__btn__')) {
    const parts = row
      .slice(7)
      .split(/[·|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return (
      `<div class="wf-btns">` +
      parts.map((p) => `<span class="wf-chip">${esc(p)}</span>`).join('') +
      `</div>`
    );
  }
  if (row.startsWith('__badge__')) {
    return `<div class="wf-badge-row"><span class="wf-badge">${esc(row.slice(9))}</span></div>`;
  }
  const sub = /^[·•]\s*/.test(row) || row.endsWith('›');
  const cls = sub && !row.endsWith('›') ? 'wf-row wf-row-sub' : 'wf-row';
  return `<div class="${cls}">${esc(row)}</div>`;
}
