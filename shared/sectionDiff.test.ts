import { describe, expect, it } from 'vitest';
import { compareMarkdownBySectionId, tokenize } from './sectionDiff';

describe('tokenize', () => {
  it('splits letter runs from digit runs', () => {
    expect(tokenize('xxxx1234')).toEqual(['xxxx', '1234']);
  });
});

describe('compareMarkdownBySectionId', () => {
  it('aligns sections by id across versions', () => {
    const from = `{#same}
## Same

old

{#gone}
## Gone

x
`;
    const to = `{#same}
## Same

new

{#added}
## Added

y
`;
    const result = compareMarkdownBySectionId(from, to);
    const byId = Object.fromEntries(result.map((s) => [s.id, s.kind]));
    expect(byId.same).toBe('changed');
    expect(byId.gone).toBe('removed');
    expect(byId.added).toBe('added');
  });
});
