import { describe, expect, it } from 'vitest';
import { hashText } from './hash';

describe('hashText (FNV-1a)', () => {
  it('is deterministic, 8-char lowercase hex, and sensitive to content', () => {
    const a = hashText('name: CI\non: push\n');
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(hashText('name: CI\non: push\n')).toBe(a);
    expect(hashText('name: CI\non: pull_request\n')).not.toBe(a);
  });
  it('hashes the empty string to the FNV-1a offset basis', () => {
    expect(hashText('')).toBe('811c9dc5');
  });
});
