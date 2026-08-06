import { describe, expect, it } from 'vitest';
import { extractSections, extractSectionBodies, slugify } from './sections';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
});

describe('extractSections', () => {
  it('splits on bare {#id} markers and reads title from following heading', () => {
    const md = `Preface text.

{#first}
## First

Body.

{#second}
## Second

More.
`;
    const { sections, hasIntro } = extractSections(md);
    expect(hasIntro).toBe(true);
    expect(sections.map((s) => ({ id: s.id, title: s.title, level: s.level }))).toEqual([
      { id: 'first', title: 'First', level: 2 },
      { id: 'second', title: 'Second', level: 2 },
    ]);
  });

  it('parses optional rank on any page marker', () => {
    const md = `{#scene rank=1}
## 用户发起账号注册

{#step rank=2}
## 账号密码
`;
    const { sections } = extractSections(md);
    expect(sections.map((s) => ({ id: s.id, title: s.title, rank: s.rank }))).toEqual([
      { id: 'scene', title: '用户发起账号注册', rank: 1 },
      { id: 'step', title: '账号密码', rank: 2 },
    ]);
  });

  it('allows untitled blocks nested under the preceding titled section', () => {
    const md = `{#parent}
## Parent

{#child-a}
Scenario body.

{#child-b}
Flow body.
`;
    const { sections, hasIntro } = extractSections(md);
    expect(hasIntro).toBe(false);
    expect(sections.map((s) => ({ id: s.id, title: s.title, level: s.level }))).toEqual([
      { id: 'parent', title: 'Parent', level: 2 },
      { id: 'child-a', title: '', level: 2 },
      { id: 'child-b', title: '', level: 2 },
    ]);
  });

  it('does not treat heading-trailing {#id} as a section boundary', () => {
    const md = `## Old Style {#old-style}

Still intro / unmarked body.

{#real}
## Real

Body.
`;
    const { sections, hasIntro } = extractSections(md);
    expect(hasIntro).toBe(true);
    expect(sections.map((s) => s.id)).toEqual(['real']);
    expect(sections[0].title).toBe('Real');
  });

  it('includes markers inside details containers (row groups in one table)', () => {
    const md = `{#outer}
## Outer

:::details users
{#inner-a}
| a | b |
| --- | --- |
| 1 | 2 |

{#inner-b}
| a | b |
| --- | --- |
| 3 | 4 |
:::
`;
    const { sections } = extractSections(md);
    expect(sections.map((s) => s.id)).toEqual(['outer', 'inner-a', 'inner-b']);
  });
});

describe('extractSectionBodies', () => {
  it('slices bodies including the leading {#id} line', () => {
    const md = `Intro

{#a}
## A

aaa

{#b}
## B

bbb
`;
    const { intro, sections } = extractSectionBodies(md);
    expect(intro).toContain('Intro');
    expect(sections).toHaveLength(2);
    expect(sections[0].body.startsWith('{#a}')).toBe(true);
    expect(sections[0].body).toContain('## A');
    expect(sections[0].body).toContain('aaa');
    expect(sections[1].body.startsWith('{#b}')).toBe(true);
    expect(sections[1].body).toContain('## B');
  });
});
