import { describe, expect, it } from 'vitest';
import { planSameCellMerges } from './tableCellMergePlan';

describe('planSameCellMerges', () => {
  it('prefers vertical merge over horizontal when both are possible', () => {
    // A A
    // A B  → left column should rowspan=2, not top row colspan=2
    const values = [
      ['A', 'A'],
      ['A', 'B'],
    ];
    const blocks = planSameCellMerges(values, [false, false]);
    expect(blocks).toContainEqual({ r: 0, c: 0, rs: 2, cs: 1, text: 'A' });
    expect(blocks).toContainEqual({ r: 0, c: 1, rs: 1, cs: 1, text: 'A' });
    expect(blocks).toContainEqual({ r: 1, c: 1, rs: 1, cs: 1, text: 'B' });
    expect(blocks.some((b) => b.r === 0 && b.c === 0 && b.cs === 2)).toBe(false);
  });

  it('still merges a full rectangle when rows and cols all match', () => {
    const values = [
      ['X', 'X'],
      ['X', 'X'],
    ];
    const blocks = planSameCellMerges(values, [false, false]);
    expect(blocks).toEqual([{ r: 0, c: 0, rs: 2, cs: 2, text: 'X' }]);
  });

  it('does not merge empty cells or across hidden rows', () => {
    const values = [
      ['A', ''],
      ['A', ''],
      ['A', 'B'],
    ];
    const blocks = planSameCellMerges(values, [false, true, false]);
    expect(blocks).toContainEqual({ r: 0, c: 0, rs: 1, cs: 1, text: 'A' });
    expect(blocks).toContainEqual({ r: 0, c: 1, rs: 1, cs: 1, text: '' });
    expect(blocks).toContainEqual({ r: 1, c: 0, rs: 1, cs: 1, text: 'A' });
    expect(blocks).toContainEqual({ r: 2, c: 0, rs: 1, cs: 1, text: 'A' });
    expect(blocks).toContainEqual({ r: 2, c: 1, rs: 1, cs: 1, text: 'B' });
  });
});
