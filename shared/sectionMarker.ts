import type MarkdownIt from 'markdown-it';

/** CSS class on rendered section-boundary anchors. */
export const SECTION_MARKER_CLASS = 'section-marker';

/** Whole-line section id marker: `{#some-id}` */
export const SECTION_MARKER_LINE_RE = /^\s*\{#([A-Za-z0-9_-]+)\}\s*$/;

/**
 * Block rule: a line that is only `{#id}` becomes a section boundary token.
 * Must run before `paragraph` (and thus before attrs) so the braces are not stolen.
 */
export function sectionMarkerPlugin(md: MarkdownIt): void {
  md.block.ruler.before(
    'paragraph',
    'section_marker',
    (state, startLine, _endLine, silent) => {
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;
      if (state.level !== 0) return false;

      const pos = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      const line = state.src.slice(pos, max);
      const m = line.match(/^\{#([A-Za-z0-9_-]+)\}$/);
      if (!m) return false;

      if (silent) return true;

      const token = state.push('section_marker', 'div', 0);
      token.block = true;
      token.map = [startLine, startLine + 1];
      token.attrSet('id', m[1]);
      token.attrSet('class', SECTION_MARKER_CLASS);
      token.markup = `{#${m[1]}}`;

      state.line = startLine + 1;
      return true;
    },
  );

  md.renderer.rules.section_marker = (tokens, idx) => {
    const id = tokens[idx].attrGet('id') ?? '';
    const esc = md.utils.escapeHtml(id);
    return `<div class="${SECTION_MARKER_CLASS}" id="${esc}"></div>\n`;
  };
}
