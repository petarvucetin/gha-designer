import { describe, expect, it } from 'vitest';
import { classifyUsesRef, usesKind } from './usesKind';

describe('usesKind', () => {
  it('treats missing/empty/whitespace-only uses as run', () => {
    expect(usesKind(undefined)).toBe('run');
    expect(usesKind('')).toBe('run');
    expect(usesKind('   ')).toBe('run');
  });

  it('classifies ./ and .\\ prefixed uses as local', () => {
    expect(usesKind('./.github/actions/x')).toBe('local');
    expect(usesKind('./x')).toBe('local');
    expect(usesKind('.\\x')).toBe('local');
  });

  it('classifies docker:// prefixed uses as docker', () => {
    expect(usesKind('docker://alpine:3')).toBe('docker');
  });

  it('classifies owner/repo[/path]@ref uses as marketplace', () => {
    expect(usesKind('actions/checkout@v4')).toBe('marketplace');
    expect(usesKind('owner/repo/path@ref')).toBe('marketplace');
    expect(usesKind('the-pr-agent/pr-agent@main')).toBe('marketplace');
  });
});

describe('classifyUsesRef', () => {
  it('classifies remote reusable-workflow refs as workflow', () => {
    expect(classifyUsesRef('octo/repo/.github/workflows/ci.yml@v1')).toBe('workflow');
    expect(classifyUsesRef('octo/repo/.github/workflows/ci.yaml@main')).toBe('workflow');
  });

  it('classifies local reusable-workflow refs as workflow', () => {
    expect(classifyUsesRef('./.github/workflows/build.yml')).toBe('workflow');
  });

  it('classifies actions (marketplace, docker, local action) as action', () => {
    expect(classifyUsesRef('actions/checkout@v4')).toBe('action');
    expect(classifyUsesRef('the-pr-agent/pr-agent@main')).toBe('action');
    expect(classifyUsesRef('owner/repo/path@ref')).toBe('action');
    expect(classifyUsesRef('docker://alpine:3')).toBe('action');
    expect(classifyUsesRef('./.github/actions/local')).toBe('action');
    expect(classifyUsesRef('')).toBe('action');
  });
});
