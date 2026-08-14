import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import markdownItAttrs from 'markdown-it-attrs';
import { collectTableRowMarkers, SECTION_ROW_CLASS, tableRowIdPlugin } from './tableRowId';
import { extractSections } from './sections';

describe('collectTableRowMarkers', () => {
  it('reads trailing {#id} on table rows', () => {
    const md = `
| 字段 | 标识 | 类型 | 约束 | {#h}
| --- | --- | --- | --- |
| 邮箱 | email | 文本 | 必填 |{#a}
| 密码哈希 | password_hash | 文本 | 必填 |
| 手机号 | phone | 文本 | 必填 |{#b}
`;
    expect(collectTableRowMarkers(md).map((m) => m.id)).toEqual(['h', 'a', 'b']);
  });

  it('accepts {#id} as last cell with closing pipe', () => {
    const md = `
| 场景 | 操作 | 系统 | {#h} |
| --- | --- | --- | --- |
| 待审 | 打开 | 列出 | {#a} |
| 通过 | 确认 | 写入 | {#b} |
`;
    expect(collectTableRowMarkers(md).map((m) => m.id)).toEqual(['h', 'a', 'b']);
  });
});

describe('tableRowIdPlugin', () => {
  const md = new MarkdownIt()
    .use(markdownItAttrs, { allowedAttributes: ['id', 'class'] })
    .use(tableRowIdPlugin);

  it('moves trailing id cell onto <tr>', () => {
    const html = md.render(`| 字段 | 标识 | {#h}
| --- | --- | --- |
| 邮箱 | email |{#a}
| 密码 | hash | |
`);
    expect(html).toContain('<table>');
    expect(html).toContain(`id="h"`);
    expect(html).toContain(`id="a"`);
    expect(html).toContain(SECTION_ROW_CLASS);
    expect(html).not.toMatch(/<(td|th)[^>]*>\s*\{#/);
    expect(html.match(new RegExp(SECTION_ROW_CLASS, 'g'))?.length).toBe(2);
  });

  it('parses a 3-column flow table whose header id sits in the last cell', () => {
    const html = md.render(`| 场景 | 操作 | 系统 | {#h1}
| --- | --- | --- | --- |
| 查看 | 打开 | 列出 | {#v1}
`);
    expect(html).toContain('<table>');
    expect(html).toContain('id="h1"');
    expect(html).toContain('id="v1"');
    expect(html).not.toMatch(/<(td|th)[^>]*>\s*\{#/);
  });

  it('does not parse a table when the header has an extra empty cell before {#id}', () => {
    const html = md.render(`| 场景 | 操作 | 系统 | | {#h1}
| --- | --- | --- | --- |
| 查看 | 打开 | 列出 | {#v1}
`);
    expect(html).not.toContain('<table>');
  });
});

describe('extractSections + table row ids', () => {
  it('lists row ids inside details users as sections', () => {
    const md = `{#wrap}
:::details users
| 字段 | 标识 | 类型 | 约束 | {#202608051481}
| --- | --- | --- | --- |
| 邮箱 | email | 文本 | 必填，≤254 |{#202608051470}
| 密码哈希 | password_hash | 文本 | 必填，隐藏 |
| 手机号 | phone | 文本 | 必填，≤20 |{#202608051473}
:::
`;
    const { sections } = extractSections(md);
    expect(sections.map((s) => s.id)).toEqual([
      'wrap',
      '202608051481',
      '202608051470',
      '202608051473',
    ]);
  });
});
