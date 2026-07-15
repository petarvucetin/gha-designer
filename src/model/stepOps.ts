import type { Step } from './types';

/** Insert `step` into `steps` at gap `index` (clamped to [0, steps.length]). Returns a new array. */
export function insertStep(steps: Step[], index: number, step: Step): Step[] {
  const at = Math.max(0, Math.min(index, steps.length));
  const next = [...steps];
  next.splice(at, 0, step);
  return next;
}

/**
 * Move the step at `from` to gap `to`, where `to` is a gap index in the ORIGINAL
 * array (0..steps.length). Dropping into the step's own slot (to === from or
 * to === from + 1) is a no-op. Returns a new array (or the same ref on no-op /
 * out-of-range `from`).
 */
export function moveStep(steps: Step[], from: number, to: number): Step[] {
  if (from < 0 || from >= steps.length) return steps;
  if (to === from || to === from + 1) return steps;
  const next = [...steps];
  const [s] = next.splice(from, 1);
  const insertAt = from < to ? to - 1 : to;
  next.splice(insertAt, 0, s);
  return next;
}
