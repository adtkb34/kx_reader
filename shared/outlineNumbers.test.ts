import { describe, expect, it } from 'vitest';
import { outlineNumbers, tocOutlineKey, tocTreeOutlineNumbers } from './outlineNumbers';

describe('outlineNumbers', () => {
  it('numbers by relative heading level among visible items', () => {
    const map = outlineNumbers([
      { id: 'a', level: 2 },
      { id: 'a1', level: 3 },
      { id: 'a2', level: 3 },
      { id: 'b', level: 2 },
      { id: 'b1', level: 3 },
    ]);
    expect(Object.fromEntries(map)).toEqual({
      a: '1',
      a1: '1.1',
      a2: '1.2',
      b: '2',
      b1: '2.1',
    });
  });

  it('fills skipped levels with 1', () => {
    const map = outlineNumbers([
      { id: 'a', level: 2 },
      { id: 'deep', level: 4 },
    ]);
    expect(Object.fromEntries(map)).toEqual({
      a: '1',
      deep: '1.1.1',
    });
  });

  it('skips empty ids and treats empty list as empty map', () => {
    expect(outlineNumbers([])).toEqual(new Map());
    expect(Object.fromEntries(outlineNumbers([{ id: '', level: 2 }]))).toEqual({});
  });

  it('uses first occurrence when ids repeat', () => {
    const map = outlineNumbers([
      { id: 'a', level: 2 },
      { id: 'a', level: 3 },
    ]);
    expect(map.get('a')).toBe('1');
  });
});

describe('tocTreeOutlineNumbers', () => {
  it('numbers groups and leaf pages by tree depth', () => {
    const map = tocTreeOutlineNumbers([
      {
        type: 'group',
        id: 'plan',
        children: [
          { type: 'page', id: 'sched' },
          { type: 'page', id: 'dispatch' },
        ],
      },
      {
        type: 'group',
        id: 'resource',
        children: [{ type: 'page', id: 'process' }],
      },
    ]);
    expect(map.get(tocOutlineKey('group', 'plan'))).toBe('1');
    expect(map.get(tocOutlineKey('page', 'sched'))).toBe('1.1');
    expect(map.get(tocOutlineKey('page', 'dispatch'))).toBe('1.2');
    expect(map.get(tocOutlineKey('group', 'resource'))).toBe('2');
    expect(map.get(tocOutlineKey('page', 'process'))).toBe('2.1');
  });
});
