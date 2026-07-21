import MarkdownIt from 'markdown-it';
import attrs from 'markdown-it-attrs';
import anchor from 'markdown-it-anchor';
import container from 'markdown-it-container';
import hljs from 'highlight.js/lib/common';
import { slugify } from '@shared/sections';
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
  html: false,
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

export function renderChapter(markdown: string, env: RenderEnv): string {
  return md.render(markdown, env);
}

/**
 * 把整章 HTML 按顶层 h2–h6 切成可标记小节。
 * 第一个标题之前的内容归入 `_intro`；折叠块内部的标题不会出现在顶层，天然不参与切分。
 * 该规则与服务端 shared/sections.ts 的目录抽取严格一致。
 */
export function splitSections(html: string): RenderedSection[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: RenderedSection[] = [];
  let current: RenderedSection | null = null;

  const flush = () => {
    if (current && current.html.trim()) out.push(current);
    current = null;
  };

  for (const node of Array.from(doc.body.childNodes)) {
    const isHeading =
      node.nodeType === Node.ELEMENT_NODE && /^H[2-6]$/.test((node as Element).tagName);
    if (isHeading) {
      const el = node as Element;
      flush();
      current = {
        id: el.id || `sec-${out.length}`,
        title: el.textContent?.trim() || '(无标题)',
        level: Number(el.tagName.slice(1)),
        html: el.outerHTML,
      };
    } else {
      const chunk =
        node.nodeType === Node.ELEMENT_NODE
          ? (node as Element).outerHTML
          : (node.textContent ?? '');
      if (!current) {
        if (!chunk.trim()) continue;
        current = { id: '_intro', title: '引言', level: 2, html: '' };
      }
      current.html += chunk;
    }
  }
  flush();
  return out;
}
