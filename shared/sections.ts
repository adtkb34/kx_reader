import MarkdownIt from 'markdown-it';
import markdownItAttrs from 'markdown-it-attrs';
import markdownItContainer from 'markdown-it-container';
import type { TocSection } from './types';
import { sectionMarkerPlugin } from './sectionMarker';
import { collectTableRowMarkers, tableRowIdPlugin } from './tableRowId';

/**
 * 与客户端 markdown-it-anchor 使用同一个 slugify，
 * 保证服务端目录抽取与客户端渲染出的 id 完全一致。
 */
export function slugify(text: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
  return s || 'section';
}

const md = new MarkdownIt()
  .use(sectionMarkerPlugin)
  .use(markdownItAttrs, { allowedAttributes: ['id', 'class'] })
  .use(tableRowIdPlugin)
  .use(markdownItContainer, 'details');

type Token = ReturnType<MarkdownIt['parse']>[number];

function inlineText(token: Token | undefined): string {
  if (!token) return '';
  if (token.children && token.children.length > 0) {
    return token.children
      .filter((t) => t.type === 'text' || t.type === 'code_inline')
      .map((t) => t.content)
      .join('')
      .trim();
  }
  return (token.content ?? '').trim();
}

export interface ExtractedSections {
  sections: TocSection[];
  hasIntro: boolean;
}

interface MarkerHit {
  id: string;
  /** Content rank from `{#id rank=N}`, if any. */
  rank?: number;
  /** 0-based start line of the `{#id}` marker */
  startLine: number;
}

function collectMarkers(markdown: string): { markers: MarkerHit[]; hasIntro: boolean } {
  const tokens = md.parse(markdown, {});
  const markers: MarkerHit[] = [];
  const seen = new Set<string>();
  let sawMarker = false;
  let hasIntro = false;

  for (const t of tokens) {
    if (t.type === 'section_marker') {
      const id = t.attrGet('id');
      if (id && !seen.has(id)) {
        const rankRaw = t.attrGet('data-rank');
        const rank =
          rankRaw != null && /^\d+$/.test(rankRaw) ? Number(rankRaw) : undefined;
        markers.push({
          id,
          startLine: t.map?.[0] ?? 0,
          ...(rank != null ? { rank } : {}),
        });
        seen.add(id);
        sawMarker = true;
      }
      continue;
    }
    if (!sawMarker && t.level === 0 && t.type !== 'section_marker') {
      // Any top-level content token before the first marker counts as intro signal.
      // Skip purely structural closes.
      if (
        t.type.endsWith('_close') ||
        t.type === 'heading_close' ||
        t.type === 'inline'
      ) {
        continue;
      }
      if (t.type.endsWith('_open') || t.type === 'html_block' || t.type === 'fence' || t.type === 'code_block' || t.type === 'hr') {
        hasIntro = true;
      }
    }
  }

  for (const row of collectTableRowMarkers(markdown)) {
    if (seen.has(row.id)) continue;
    markers.push({ id: row.id, startLine: row.startLine });
    seen.add(row.id);
    sawMarker = true;
  }

  markers.sort((a, b) => a.startLine - b.startLine || a.id.localeCompare(b.id));
  return { markers, hasIntro };
}

/** First top-level h2–h6 in markdown fragment (not inside details). */
function firstHeadingMeta(fragment: string): { title: string; level: number } | null {
  if (!fragment.trim()) return null;
  const tokens = md.parse(fragment, {});
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open' && t.level === 0) {
      const level = Number(t.tag.slice(1));
      if (level >= 2) {
        const title = inlineText(tokens[i + 1]);
        return { title, level };
      }
    }
  }
  return null;
}

function assignSectionMetas(
  markers: MarkerHit[],
  lines: string[],
): TocSection[] {
  const sections: TocSection[] = [];
  let lastTitledLevel = 1;

  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const end = i + 1 < markers.length ? markers[i + 1].startLine : lines.length;
    // Content after the marker line
    const fragment = lines.slice(m.startLine + 1, end).join('\n');
    const heading = firstHeadingMeta(fragment);
    let title: string;
    let level: number;
    if (heading && heading.title) {
      title = heading.title;
      level = heading.level;
      lastTitledLevel = level;
    } else if (heading) {
      // Empty heading text — treat as untitled
      title = '';
      // Same level as preceding titled section so lens siblings are not
      // swallowed by expandSectionAllowlist when the shared parent is listed.
      level = Math.max(lastTitledLevel, 2);
    } else {
      title = '';
      level = Math.max(lastTitledLevel, 2);
    }
    sections.push({
      id: m.id,
      title,
      level,
      ...(m.rank != null ? { rank: m.rank } : {}),
    });
  }

  return sections;
}

/**
 * 抽取章节里的可标记小节（独占行 `{#id}` / `{#id rank=N}` 为边界）。
 * - 折叠块内的标记也算小节（便于一张表内标记行组）。
 * - 第一个标记之前若存在正文，则记 hasIntro。
 * - 节标题/层级取节内第一个 h2–h6；无标题则 title 为空、level = 最近有标题节 level。
 */
export function extractSections(markdown: string): ExtractedSections {
  const lines = markdown.split('\n');
  const { markers, hasIntro } = collectMarkers(markdown);
  return {
    sections: assignSectionMetas(markers, lines),
    hasIntro,
  };
}

export interface SectionBody {
  id: string;
  title: string;
  level: number;
  rank?: number;
  /** 该小节的 Markdown 原文（含开头 `{#id}` 行） */
  body: string;
}

export interface ExtractedSectionBodies {
  /** 首个小节标记之前的引言正文；无引言则为 null */
  intro: string | null;
  sections: SectionBody[];
}

function sliceLines(lines: string[], start: number, endExclusive: number): string {
  return lines.slice(start, endExclusive).join('\n').replace(/\s+$/, '');
}

/** 按与阅读器一致的小节切分，返回每段 Markdown 原文。 */
export function extractSectionBodies(markdown: string): ExtractedSectionBodies {
  const lines = markdown.split('\n');
  const { markers, hasIntro } = collectMarkers(markdown);
  const metas = assignSectionMetas(markers, lines);
  const sections: SectionBody[] = [];

  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const end = i + 1 < markers.length ? markers[i + 1].startLine : lines.length;
    const meta = metas[i];
    sections.push({
      id: m.id,
      title: meta.title,
      level: meta.level,
      ...(meta.rank != null ? { rank: meta.rank } : {}),
      body: sliceLines(lines, m.startLine, end),
    });
  }

  let intro: string | null = null;
  if (hasIntro) {
    const end = markers.length > 0 ? markers[0].startLine : lines.length;
    const body = sliceLines(lines, 0, end);
    intro = body.length > 0 ? body : null;
  }

  return { intro, sections };
}

/** 规范化后再 hash，避免无关尾空白导致误伤。 */
export function normalizeSectionBody(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/\s+$/g, '');
}
