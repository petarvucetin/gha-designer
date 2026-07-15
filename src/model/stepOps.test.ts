import { describe, expect, it } from 'vitest';
import { insertStep, moveStep } from './stepOps';
import type { Step } from './types';

const a: Step = { id: 'a' };
const b: Step = { id: 'b' };
const c: Step = { id: 'c' };

describe('insertStep', () => {
  it('inserts at the top (index 0)', () => {
    const steps = [a, b, c];
    expect(insertStep(steps, 0, { id: 'x' })).toEqual([{ id: 'x' }, a, b, c]);
  });

  it('inserts at the bottom (index === length, i.e. append)', () => {
    const steps = [a, b, c];
    expect(insertStep(steps, 3, { id: 'x' })).toEqual([a, b, c, { id: 'x' }]);
  });

  it('inserts in the middle', () => {
    const steps = [a, b, c];
    expect(insertStep(steps, 1, { id: 'x' })).toEqual([a, { id: 'x' }, b, c]);
  });

  it('clamps a negative index to 0', () => {
    const steps = [a, b, c];
    expect(insertStep(steps, -5, { id: 'x' })).toEqual([{ id: 'x' }, a, b, c]);
  });

  it('clamps an index beyond length to length (append)', () => {
    const steps = [a, b, c];
    expect(insertStep(steps, 999, { id: 'x' })).toEqual([a, b, c, { id: 'x' }]);
  });

  it('does not mutate the original array', () => {
    const steps = [a, b, c];
    const result = insertStep(steps, 1, { id: 'x' });
    expect(steps).toEqual([a, b, c]);
    expect(result).not.toBe(steps);
  });
});

describe('moveStep', () => {
  it('moves the first step to the end', () => {
    const steps = [a, b, c];
    expect(moveStep(steps, 0, 3)).toEqual([b, c, a]);
  });

  it('moves the last step to the front', () => {
    const steps = [a, b, c];
    expect(moveStep(steps, 2, 0)).toEqual([c, a, b]);
  });

  it('moves a middle step down', () => {
    const steps = [a, b, c];
    // move b (index 1) to gap 3 (end) -> [a, c, b]
    expect(moveStep(steps, 1, 3)).toEqual([a, c, b]);
  });

  it('moves a middle step up', () => {
    const steps = [a, b, c];
    // move c (index 2) to gap 1 (between a and b) -> [c, a, b]... wait, check gap semantics
    // from=2, to=1: to !== from, to !== from+1, so it's a real move.
    // insertAt = from < to ? to-1 : to = 2<1 false -> insertAt = 1
    // remove c -> [a,b], insert at 1 -> [a, c, b]
    expect(moveStep(steps, 2, 1)).toEqual([a, c, b]);
  });

  it('is a no-op when dropping into the same gap before the step (to === from)', () => {
    const steps = [a, b, c];
    const result = moveStep(steps, 1, 1);
    expect(result).toBe(steps);
  });

  it('is a no-op when dropping into the gap right after the step (to === from + 1)', () => {
    const steps = [a, b, c];
    const result = moveStep(steps, 1, 2);
    expect(result).toBe(steps);
  });

  it('returns the same reference when from is out of range', () => {
    const steps = [a, b, c];
    expect(moveStep(steps, -1, 0)).toBe(steps);
    expect(moveStep(steps, 3, 0)).toBe(steps);
  });

  it('does not mutate the original array on a real move', () => {
    const steps = [a, b, c];
    const result = moveStep(steps, 0, 2);
    expect(steps).toEqual([a, b, c]);
    expect(result).toEqual([b, a, c]);
    expect(result).not.toBe(steps);
  });
});
