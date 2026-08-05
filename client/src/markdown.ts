import MarkdownIt from 'markdown-it';
import attrs from 'markdown-it-attrs';
import anchor from 'markdown-it-anchor';
import container from 'markdown-it-container';
import hljs from 'highlight.js/lib/common';
import { slugify } from '@shared/sections';
import { SECTION_MARKER_CLASS, sectionMarkerPlugin } from '@shared/sectionMarker';
import { renderWireframe } from '@/wireframe';

export interface RenderEnv {
  bookId: string;
  /** 章节文件名 -> 章节 id，用于把 `xx.md#hash` 改写为应用内路由 */
  fileToChapter: Record<string, string>;
}

export interface RenderedSection {
  id: string;
  title: string;
  level: number;
  html: string;
}

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(code, lang) {
    // Mermaid：交给客户端懒加载渲染，不要走 highlight.js
    if (lang === 'mermaid') {
      return (
        `<div class="mermaid-wrap">` +
        `<pre class="mermaid">${md.utils.escapeHtml(code.trim())}</pre>` +
        `</div>`
      );
    }
    if (lang === 'wireframe') {
      return renderWireframe(code);
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        const value = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="hljs"><code>${value}</code></pre>`;
      } catch {
        // fall through to escaped output
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
  },
});

md.use(sectionMarkerPlugin);
md.use(attrs, { allowedAttributes: ['id', 'class'] });
md.use(anchor, { slugify });
md.use(container, 'details', {
  render(tokens: { nesting: number; info: string }[], idx: number) {
    const token = tokens[idx];
    if (token.nesting === 1) {
      const title = token.info.trim().replace(/^details\s*/, '');
      const summary = md.utils.escapeHtml(title || '查看细节');
      return `<details class="md-details"><summary>${summary}</summary><div class="md-details-body">\n`;
    }
    return '</div></details>\n';
  },
});

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env: RenderEnv, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') ?? '';
  if (href.startsWith('#')) {
    token.attrSet('data-internal', 'hash');
  } else if (/^(?:https?:)?\/\//.test(href) || href.startsWith('mailto:')) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noreferrer');
  } else {
    const m = href.match(/^([^#?]+\.md)(#.*)?$/);
    if (m && env?.fileToChapter) {
      const file = m[1].split('/').pop() ?? m[1];
      const chapterId = env.fileToChapter[file] ?? env.fileToChapter[m[1]];
      if (chapterId) {
        token.attrSet('href', `/books/${env.bookId}/${chapterId}${m[2] ?? ''}`);
        token.attrSet('data-internal', 'chapter');
      }
    }
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

function rewriteImageSrc(src: string, bookId: string): string {
  if (!src) return src;
  if (/^(?:https?:)?\/\//.test(src) || src.startsWith('data:')) return src;
  if (src.startsWith('/api/books/')) return src;
  // Strip leading ./ and normalize to assets/...
  const cleaned = src.replace(/^\.\//, '');
  if (cleaned.startsWith('assets/')) {
    return `/api/books/${bookId}/${cleaned}`;
  }
  return src;
}

md.renderer.rules.image = (tokens, idx, options, env: RenderEnv, self) => {
  const token = tokens[idx];
  const rawSrc = token.attrGet('src') ?? '';
  const src = rewriteImageSrc(rawSrc, env?.bookId ?? '');
  token.attrSet('src', src);
  token.attrSet('loading', 'lazy');

  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  const escapedAlt = md.utils.escapeHtml(alt);
  const escapedSrc = md.utils.escapeHtml(src);
  // Use span (not figure) so the tag stays valid inside markdown-it's <p> wrapper.
  const caption =
    alt.trim().length > 0 ? `<span class="md-figcaption">${escapedAlt}</span>` : '';

  return (
    `<span class="md-figure">` +
    `<img src="${escapedSrc}" alt="${escapedAlt}" loading="lazy" />` +
    caption +
    `</span>`
  );
};

export function renderChapter(markdown: string, env: RenderEnv): string {
  let html = md.render(markdown, env);
  // Raw HTML <a href="….md"> (e.g. rowspan tables) still need in-app routes.
  html = html.replace(
    /href="((?:[^"#?]+\.md))(#[^"]*)?"/g,
    (full, filePath: string, hash: string = '') => {
      if (!env?.fileToChapter) return full;
      const file = filePath.split('/').pop() ?? filePath;
      const chapterId = env.fileToChapter[file] ?? env.fileToChapter[filePath];
      if (!chapterId) return full;
      return `href="/books/${env.bookId}/${chapterId}${hash || ''}" data-internal="chapter"`;
    },
  );
  return html;
}

function isSectionMarker(node: Node): node is Element {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    (node as Element).tagName === 'DIV' &&
    (node as Element).classList.contains(SECTION_MARKER_CLASS) &&
    !!(node as Element).id
  );
}

function firstHeadingInHtml(html: string): { title: string; level: number } | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const node of Array.from(doc.body.querySelectorAll('h2, h3, h4, h5, h6'))) {
    // Skip headings nested inside details / blockquote-like wrappers that are not top-level.
    let parent = node.parentElement;
    let topLevel = true;
    while (parent && parent !== doc.body) {
      const tag = parent.tagName;
      if (tag === 'DETAILS' || tag === 'BLOCKQUOTE') {
        topLevel = false;
        break;
      }
      parent = parent.parentElement;
    }
    if (!topLevel) continue;
    const title = node.textContent?.trim() ?? '';
    if (!title) continue;
    return { title, level: Number(node.tagName.slice(1)) };
  }
  return null;
}

/**
 * 把整章 HTML 按 `.section-marker` 切成可标记小节。
 * 第一个标记之前的内容归入 `_intro`；折叠块内部的标记不会出现在顶层。
 * 与服务端 shared/sections.ts 的目录抽取严格一致。
 */
export function splitSections(html: string): RenderedSection[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const raw: { id: string; html: string }[] = [];
  let current: { id: string; html: string } | null = null;

  const flush = () => {
    if (current && current.html.trim()) raw.push(current);
    current = null;
  };

  for (const node of Array.from(doc.body.childNodes)) {
    if (isSectionMarker(node)) {
      flush();
      current = { id: node.id, html: node.outerHTML };
      continue;
    }
    const chunk =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as Element).outerHTML
        : (node.textContent ?? '');
    if (!current) {
      if (!chunk.trim()) continue;
      current = { id: '_intro', html: '' };
    }
    current.html += chunk;
  }
  flush();

  const out: RenderedSection[] = [];
  let lastTitledLevel = 1;
  for (const sec of raw) {
    if (sec.id === '_intro') {
      out.push({ id: '_intro', title: '引言', level: 2, html: sec.html });
      continue;
    }
    // Title comes from body after the marker element
    const withoutMarker = sec.html.replace(
      new RegExp(`^<div class="${SECTION_MARKER_CLASS}" id="[^"]*"></div>\\n?`),
      '',
    );
    const heading = firstHeadingInHtml(withoutMarker);
    let title: string;
    let level: number;
    if (heading) {
      title = heading.title;
      level = heading.level;
      lastTitledLevel = level;
    } else {
      title = '';
      // Match server: untitled shares level with preceding titled section
      // so expandSectionAllowlist does not pull in lens sibling blocks.
      level = Math.max(lastTitledLevel, 2);
    }
    out.push({ id: sec.id, title, level, html: sec.html });
  }
  return out;
}
