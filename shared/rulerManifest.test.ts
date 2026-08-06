import { describe, expect, it } from 'vitest';
import { parseBookRuler } from './rulerManifest';

describe('parseBookRuler', () => {
  const lenses = {
    read: [
      { id: 'biz', title: '业务' },
      {
        id: 'spec',
        title: '规格',
        children: [{ id: 'entity', title: '实体' }],
      },
    ],
  };

  it('keeps ruler when links is an empty object (skeleton book)', () => {
    expect(
      parseBookRuler('demo', { axis: 'read', links: {} }, lenses),
    ).toEqual({ axis: 'read', links: {} });
  });

  it('still parses non-empty links', () => {
    expect(
      parseBookRuler(
        'demo',
        { axis: 'read', links: { k1: ['a', 'b'] } },
        lenses,
      ),
    ).toEqual({ axis: 'read', links: { k1: ['a', 'b'] } });
  });

  it('keeps outline-only keys with empty hang arrays', () => {
    expect(
      parseBookRuler(
        'demo',
        { axis: 'read', links: { parent: [], child: ['a'] } },
        lenses,
      ),
    ).toEqual({ axis: 'read', links: { parent: [], child: ['a'] } });
  });
});
