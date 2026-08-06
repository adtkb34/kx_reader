import type MarkdownIt from 'markdown-it';

/** CSS class on rendered section-boundary anchors. */
export const SECTION_MARKER_CLASS = 'section-marker';

/**
 * Whole-line section id marker: `{#some-id}` or `{#some-id rank=1}`.
 * Captures: [1]=id, [2]=optional rank digits.
 */
export const SECTION_MARKER_LINE_RE =
  /^\s*\{#([A-Za-z0-9_-]+)(?:\s+rank=(\d+))?\}\s*$/;

/**
 * Block rule: a line that is only `{#id}` / `{#id rank=N}` becomes a section boundary.
 * Must run before `paragraph` (and thus before attrs) so the braces are not stolen.
 * Allowed inside containers (e.g. :::details) so one table can mark row groups.
 */
export function sectionMarkerPlugin(md: MarkdownIt): void {
  md.block.ruler.before(
    'paragraph',
    'section_marker',
    (state, startLine, _endLine, silent) => {
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;

      const pos = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      const line = state.src.slice(pos, max);
      const m = line.match(/^\{#([A-Za-z0-9_-]+)(?:\s+rank=(\d+))?\}$/);
      if (!m) return false;

      if (silent) return true;

      const token = state.push('section_marker', 'div', 0);
      token.block = true;
      token.map = [startLine, startLine + 1];
      token.attrSet('id', m[1]);
      token.attrSet('class', SECTION_MARKER_CLASS);
      if (m[2] != null) token.attrSet('data-rank', m[2]);
      token.markup = m[2] != null ? `{#${m[1]} rank=${m[2]}}` : `{#${m[1]}}`;

      state.line = startLine + 1;
      return true;
    },
  );

  md.renderer.rules.section_marker = (tokens, idx) => {
    const id = tokens[idx].attrGet('id') ?? '';
    const esc = md.utils.escapeHtml(id);
    const rank = tokens[idx].attrGet('data-rank');
    const rankAttr = rank != null ? ` data-rank="${md.utils.escapeHtml(rank)}"` : '';
    return `<div class="${SECTION_MARKER_CLASS}" id="${esc}"${rankAttr}></div>\n`;
  };
}
