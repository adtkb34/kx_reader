import { describe, expect, it } from 'vitest';
import { extractSections, extractSectionBodies, slugify } from './sections';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
});

describe('extractSections', () => {
  it('reads explicit heading ids and detects intro', () => {
    const md = `Preface text.

## First {#first}

Body.

## Second {#second}

More.
`;
    const { sections, hasIntro } = extractSections(md);
    expect(hasIntro).toBe(true);
    expect(sections.map((s) => s.id)).toEqual(['first', 'second']);
  });

  it('ignores headings inside details containers', () => {
    const md = `## Outer {#outer}

::: details
## Inner {#inner}
:::
`;
    const { sections } = extractSections(md);
    expect(sections.map((s) => s.id)).toEqual(['outer']);
  });
});

describe('extractSectionBodies', () => {
  it('slices bodies by heading start lines', () => {
    const md = `Intro

## A {#a}

aaa

## B {#b}

bbb
`;
    const { intro, sections } = extractSectionBodies(md);
    expect(intro).toContain('Intro');
    expect(sections).toHaveLength(2);
    expect(sections[0].body).toContain('## A');
    expect(sections[0].body).toContain('aaa');
    expect(sections[1].body).toContain('## B');
  });
});
