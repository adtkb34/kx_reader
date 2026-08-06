import type MarkdownIt from 'markdown-it';

/** Class on <tr> that starts a row-group interval for ruler hang-off. */
export const SECTION_ROW_CLASS = 'section-row-marker';

/** Trailing `{#id}` on a GFM table row (last cell or after final pipe). */
export const TABLE_ROW_ID_LINE_RE = /^(\|.*)\{\#([A-Za-z0-9_-]+)\}\s*$/;

export interface TableRowMarker {
  id: string;
  /** 0-based line index in the markdown source */
  startLine: number;
}

function inlinePlainText(token: {
  content?: string;
  children?: { type: string; content: string }[] | null;
}): string {
  if (token.children?.length) {
    return token.children
      .filter((t) => t.type === 'text' || t.type === 'code_inline')
      .map((t) => t.content)
      .join('')
      .trim();
  }
  return (token.content ?? '').trim();
}

/** Scan source lines for table rows that end with `{#id}`. */
export function collectTableRowMarkers(markdown: string): TableRowMarker[] {
  const lines = markdown.split('\n');
  const out: TableRowMarker[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes('{#')) continue;
    if (/^\|[\s|:-]+\|\s*$/.test(line)) continue;
    const m = line.match(TABLE_ROW_ID_LINE_RE);
    if (!m) continue;
    const id = m[2]!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, startLine: i });
  }
  return out;
}

type MdToken = {
  type: string;
  content?: string;
  children?: { type: string; content: string }[] | null;
  attrGet: (name: string) => string | null;
  attrSet: (name: string, value: string) => void;
  attrJoin: (name: string, value: string) => void;
};

function promoteRowIds(tokens: MdToken[]): Set<number> {
  const touchedTables = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.type !== 'tr_open') continue;

    let tableIdx = -1;
    for (let k = i; k >= 0; k--) {
      if (tokens[k]!.type === 'table_open') {
        tableIdx = k;
        break;
      }
      if (tokens[k]!.type === 'table_close') break;
    }

    const cellOpens: number[] = [];
    let j = i + 1;
    while (j < tokens.length && tokens[j]!.type !== 'tr_close') {
      const t = tokens[j]!;
      if (t.type === 'th_open' || t.type === 'td_open') cellOpens.push(j);
      j += 1;
    }
    if (cellOpens.length === 0) continue;

    const lastOpenIdx = cellOpens[cellOpens.length - 1]!;
    const open = tokens[lastOpenIdx]!;
    const inline = tokens[lastOpenIdx + 1];
    const close = tokens[lastOpenIdx + 2];
    if (!inline || inline.type !== 'inline' || !close?.type.endsWith('_close')) continue;

    const text = inlinePlainText(inline);
    const fromText = text.match(/^\{#([A-Za-z0-9_-]+)\}$/);
    const fromAttr = open.attrGet('id');
    const id =
      fromText?.[1] ??
      (fromAttr && (text === '' || text === `{#${fromAttr}}`) ? fromAttr : null);
    if (!id) continue;

    tokens[i]!.attrSet('id', id);
    tokens[i]!.attrJoin('class', SECTION_ROW_CLASS);
    tokens.splice(lastOpenIdx, 3);
    if (tableIdx >= 0) touchedTables.add(tableIdx);
  }
  return touchedTables;
}

/** Drop trailing empty cells on unmarked rows so they match marked rows after id strip. */
function alignTrailingEmptyCells(tokens: MdToken[], touchedTables: Set<number>): void {
  for (const tableIdx of [...touchedTables].sort((a, b) => b - a)) {
    let i = tableIdx + 1;
    while (i < tokens.length && tokens[i]!.type !== 'table_close') {
      if (tokens[i]!.type !== 'tr_open') {
        i += 1;
        continue;
      }
      const trOpen = i;
      if (tokens[trOpen]!.attrGet('class')?.includes(SECTION_ROW_CLASS)) {
        while (i < tokens.length && tokens[i]!.type !== 'tr_close') i += 1;
        i += 1;
        continue;
      }
      const cellOpens: number[] = [];
      let j = trOpen + 1;
      while (j < tokens.length && tokens[j]!.type !== 'tr_close') {
        if (tokens[j]!.type === 'th_open' || tokens[j]!.type === 'td_open') cellOpens.push(j);
        j += 1;
      }
      if (cellOpens.length > 0) {
        const lastOpenIdx = cellOpens[cellOpens.length - 1]!;
        const inline = tokens[lastOpenIdx + 1];
        if (inline?.type === 'inline' && inlinePlainText(inline) === '') {
          tokens.splice(lastOpenIdx, 3);
        }
      }
      while (i < tokens.length && tokens[i]!.type !== 'tr_close') i += 1;
      i += 1;
    }
  }
}

/**
 * Move trailing `{#id}` cell onto the parent <tr>, so one table stays intact
 * while row groups remain addressable for ruler links.
 */
export function tableRowIdPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'table_row_id', (state) => {
    const touched = promoteRowIds(state.tokens as MdToken[]);
    alignTrailingEmptyCells(state.tokens as MdToken[], touched);
  });
}
