import { describe, expect, it } from 'vitest';
import { exportFileName, slugify } from './exportYaml';

describe('slugify', () => {
  it('lowercases, dashes, and strips leading/trailing dashes', () => {
    expect(slugify('My Workflow!')).toBe('my-workflow');
  });
  it('falls back to "workflow" for an empty/blank name', () => {
    expect(slugify('   ')).toBe('workflow');
  });
});

describe('exportFileName', () => {
  it('keeps a valid fileName verbatim, ignoring the workflow name', () => {
    expect(exportFileName('build.yml', 'anything at all')).toBe('build.yml');
  });
  it('falls back to a slug of the name when fileName is empty', () => {
    expect(exportFileName('', 'My Workflow')).toBe('my-workflow.yml');
  });
  it('falls back to a slug of the name when fileName is invalid (spaces, no valid extension)', () => {
    expect(exportFileName('bad name', 'My Workflow')).toBe('my-workflow.yml');
  });
});
