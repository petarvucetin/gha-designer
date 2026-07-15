import { describe, expect, it } from 'vitest';
import { extractDefaultBranch, extractFromMarketplaceHtml, extractSourceRepo, parseGithubUrl } from './resolveRef';

describe('parseGithubUrl', () => {
  it('marketplace action → fetchMarketplace', () => {
    expect(parseGithubUrl('https://github.com/marketplace/actions/figma-action')).toEqual({
      fetchMarketplace: 'https://github.com/marketplace/actions/figma-action',
    });
  });

  it('reusable workflow file via blob URL → done workflow ref', () => {
    expect(parseGithubUrl('https://github.com/octo/repo/blob/v1/.github/workflows/ci.yml')).toEqual({
      done: { kind: 'workflow', ref: 'octo/repo/.github/workflows/ci.yml@v1', name: 'ci.yml' },
    });
  });

  it('reusable workflow file via tree URL → done workflow ref', () => {
    expect(parseGithubUrl('https://github.com/octo/repo/tree/main/.github/workflows/build.yaml')).toEqual({
      done: { kind: 'workflow', ref: 'octo/repo/.github/workflows/build.yaml@main', name: 'build.yaml' },
    });
  });

  it('plain repo → done action ref', () => {
    expect(parseGithubUrl('https://github.com/The-PR-Agent/pr-agent')).toEqual({
      done: { kind: 'action', ref: 'The-PR-Agent/pr-agent', name: 'pr-agent' },
    });
  });

  it('non-github.com host → null', () => {
    expect(parseGithubUrl('https://example.com/x')).toBeNull();
  });

  it('non-https github.com → null', () => {
    expect(parseGithubUrl('http://github.com/a/b')).toBeNull();
  });

  it('not a URL → null', () => {
    expect(parseGithubUrl('not a url')).toBeNull();
  });

  it('single path segment → null', () => {
    expect(parseGithubUrl('https://github.com/only-one-seg')).toBeNull();
  });

  it('marketplace category page (no slug) → null', () => {
    expect(parseGithubUrl('https://github.com/marketplace/actions')).toBeNull();
  });

  it('marketplace non-actions section → null', () => {
    expect(parseGithubUrl('https://github.com/marketplace/collections/foo')).toBeNull();
  });

  it('reserved owner (settings) → null', () => {
    expect(parseGithubUrl('https://github.com/settings/profile')).toBeNull();
  });

  it('reserved owner (features) → null', () => {
    expect(parseGithubUrl('https://github.com/features/actions')).toBeNull();
  });
});

describe('extractFromMarketplaceHtml', () => {
  it('extracts uses: ref and title-derived name', () => {
    const html = '<title>Figma Action · Actions · GitHub Marketplace · GitHub</title> ... uses: primer/figma-action@v1.0.0-alpha.3 ...';
    expect(extractFromMarketplaceHtml(html)).toEqual({ ref: 'primer/figma-action@v1.0.0-alpha.3', name: 'Figma Action' });
  });

  it('returns undefined ref when no uses: snippet present', () => {
    const html = '<title>Some Action · Actions · GitHub Marketplace · GitHub</title> no install snippet here';
    expect(extractFromMarketplaceHtml(html)).toEqual({ ref: undefined, name: 'Some Action' });
  });

  it('strips a literal backslash-n line break embedded in a JSON/JS blob (regression)', () => {
    // Note: this is a literal two-char `\n` (backslash + n) baked into the source string,
    // not a real newline — reproduces GitHub's marketplace page JSON blob encoding.
    const html = '... uses: the-pr-agent/pr-agent@main\\n ...';
    expect(extractFromMarketplaceHtml(html)).toEqual({ ref: 'the-pr-agent/pr-agent@main', name: undefined });
  });

  it('strips a literal backslash-n line break with a prerelease-style ref (regression)', () => {
    const html = '... uses: primer/figma-action@v1.0.0-alpha.3\\n ...';
    expect(extractFromMarketplaceHtml(html)).toEqual({ ref: 'primer/figma-action@v1.0.0-alpha.3', name: undefined });
  });

  it('stops at a real newline', () => {
    const html = 'uses: owner/repo@v1\n';
    expect(extractFromMarketplaceHtml(html)).toEqual({ ref: 'owner/repo@v1', name: undefined });
  });

  it('stops at surrounding quotes', () => {
    const html = '"uses: owner/repo@v1"';
    expect(extractFromMarketplaceHtml(html)).toEqual({ ref: 'owner/repo@v1', name: undefined });
  });

  it('page WITH a uses: snippet → ref stays primary, repo also present', () => {
    const html = '<title>Figma Action · Actions · GitHub Marketplace · GitHub</title> uses: primer/figma-action@v1.0.0-alpha.3 '
      + 'href="/primer/figma-action" href="/primer/figma-action/releases" href="/primer/figma-action" ';
    expect(extractFromMarketplaceHtml(html)).toEqual({
      ref: 'primer/figma-action@v1.0.0-alpha.3',
      repo: 'primer/figma-action',
      name: 'Figma Action',
    });
  });

  it('page WITHOUT a uses: snippet but with repo links → ref undefined, repo from dominant link', () => {
    const html = '<title>PyCharm Python Security Scanner · Actions · GitHub Marketplace · GitHub</title> '
      + 'href="/features/actions" href="/marketplace/actions/foo" '
      + 'href="/tonybaloney/pycharm-security" href="/tonybaloney/pycharm-security/releases" href="/tonybaloney/pycharm-security" ';
    expect(extractFromMarketplaceHtml(html)).toEqual({
      ref: undefined,
      repo: 'tonybaloney/pycharm-security',
      name: 'PyCharm Python Security Scanner',
    });
  });
});

describe('extractSourceRepo', () => {
  it('excludes reserved owners and picks the dominant non-reserved owner/repo', () => {
    const html = 'href="/features/x" href="/marketplace/actions/y" '
      + 'href="/tonybaloney/pycharm-security" href="/tonybaloney/pycharm-security/releases" href="/tonybaloney/pycharm-security" ';
    expect(extractSourceRepo(html)).toBe('tonybaloney/pycharm-security');
  });

  it('returns undefined when there is no non-reserved repo link', () => {
    const html = 'href="/features/x" href="/marketplace/actions/y" href="/settings/profile"';
    expect(extractSourceRepo(html)).toBeUndefined();
  });
});

describe('extractDefaultBranch', () => {
  it('extracts "master"', () => {
    expect(extractDefaultBranch('… "defaultBranch":"master" …')).toBe('master');
  });

  it('extracts "main"', () => {
    expect(extractDefaultBranch('… "defaultBranch":"main" …')).toBe('main');
  });

  it('returns undefined when no match', () => {
    expect(extractDefaultBranch('no default branch here')).toBeUndefined();
  });
});
