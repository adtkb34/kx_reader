import MarkdownIt from 'markdown-it';
import markdownItAttrs from 'markdown-it-attrs';
import markdownItContainer from 'markdown-it-container';
import type { TocSection } from './types';

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
  .use(markdownItAttrs, { allowedAttributes: ['id', 'class'] })
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

interface HeadingHit {
  id: string;
  title: string;
  level: number;
  /** 0-based start line in source */
  startLine: number;
}

function collectHeadings(markdown: string): { headings: HeadingHit[]; hasIntro: boolean } {
  const tokens = md.parse(markdown, {});
  const headings: HeadingHit[] = [];
  const seen = new Map<string, number>();
  let sawSection = false;
  let hasIntro = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open' && t.level === 0) {
      const level = Number(t.tag.slice(1));
      if (level >= 2) {
        sawSection = true;
        const title = inlineText(tokens[i + 1]) || '(无标题)';
        let id = t.attrGet('id');
        if (!id) {
          const base = slugify(title);
          const n = seen.get(base) ?? 0;
          seen.set(base, n + 1);
          id = n === 0 ? base : `${base}-${n}`;
        } else {
          seen.set(id, (seen.get(id) ?? 0) + 1);
        }
        const startLine = t.map?.[0] ?? 0;
        headings.push({ id, title, level, startLine });
        i += 2;
        continue;
      }
    }
    if (!sawSection && t.level === 0 && t.type !== 'heading_close') hasIntro = true;
  }

  return { headings, hasIntro };
}

/**
 * 抽取章节里的可标记小节（顶层 h2–h6）。
 * - 折叠块 / 引用块内部的标题 token.level > 0，不算小节（与客户端 DOM 分组规则一致）。
 * - 第一个小节标题之前若存在正文，则记 hasIntro，前端会归入 `_intro` 小节。
 */
export function extractSections(markdown: string): ExtractedSections {
  const { headings, hasIntro } = collectHeadings(markdown);
  return {
    sections: headings.map(({ id, title, level }) => ({ id, title, level })),
    hasIntro,
  };
}

export interface SectionBody {
  id: string;
  title: string;
  level: number;
  /** 该小节的 Markdown 原文（含标题行），用于内容 hash */
  body: string;
}

export interface ExtractedSectionBodies {
  /** 首个 h2 之前的引言正文；无引言则为 null */
  intro: string | null;
  sections: SectionBody[];
}

function sliceLines(lines: string[], start: number, endExclusive: number): string {
  return lines.slice(start, endExclusive).join('\n').replace(/\s+$/, '');
}

/** 按与阅读器一致的小节切分，返回每段 Markdown 原文。 */
export function extractSectionBodies(markdown: string): ExtractedSectionBodies {
  const lines = markdown.split('\n');
  const { headings, hasIntro } = collectHeadings(markdown);
  const sections: SectionBody[] = [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const end = i + 1 < headings.length ? headings[i + 1].startLine : lines.length;
    sections.push({
      id: h.id,
      title: h.title,
      level: h.level,
      body: sliceLines(lines, h.startLine, end),
    });
  }

  let intro: string | null = null;
  if (hasIntro) {
    const end = headings.length > 0 ? headings[0].startLine : lines.length;
    const body = sliceLines(lines, 0, end);
    intro = body.length > 0 ? body : null;
  }

  return { intro, sections };
}

/** 规范化后再 hash，避免无关尾空白导致误伤。 */
export function normalizeSectionBody(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/\s+$/g, '');
}
