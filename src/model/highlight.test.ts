import { describe, expect, it } from 'vitest';
import { highlightCode, languageForPath } from './highlight';

describe('languageForPath', () => {
  it('maps common extensions to registered languages', () => {
    expect(languageForPath('.github/scripts/changed_systems.py')).toBe('python');
    expect(languageForPath('action.yml')).toBe('yaml');
    expect(languageForPath('a/b/index.ts')).toBe('typescript');
    expect(languageForPath('c.tsx')).toBe('typescript');
    expect(languageForPath('main.js')).toBe('javascript');
    expect(languageForPath('data.json')).toBe('json');
    expect(languageForPath('run.sh')).toBe('bash');
    expect(languageForPath('deploy.ps1')).toBe('powershell');
    expect(languageForPath('README.md')).toBe('markdown');
    expect(languageForPath('Config.toml')).toBe('ini');
  });

  it('resolves special filenames without an extension', () => {
    expect(languageForPath('.github/Dockerfile')).toBe('dockerfile');
    expect(languageForPath('DOCKERFILE')).toBe('dockerfile');
    expect(languageForPath('.gitignore')).toBe('bash');
    expect(languageForPath('Makefile')).toBe('bash');
  });

  it('handles Windows backslash paths', () => {
    expect(languageForPath('scripts\\build.py')).toBe('python');
  });

  it('returns null for unknown or extension-less files', () => {
    expect(languageForPath('data.bin')).toBeNull();
    expect(languageForPath('LICENSE')).toBeNull();
    expect(languageForPath('noext')).toBeNull();
  });
});

describe('highlightCode', () => {
  it('produces token markup for a known language', () => {
    const { language, html } = highlightCode('x.py', 'import os\nx = 1');
    expect(language).toBe('python');
    expect(html).toContain('hljs-'); // at least one token span class
    expect(html).toContain('import');
  });

  it('escapes unknown-language content so it cannot inject markup', () => {
    const { language, html } = highlightCode('x.bin', '<script>alert(1)</script> & <b>');
    expect(language).toBeNull();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('escapes special characters inside highlighted known-language source too', () => {
    const { html } = highlightCode('x.js', 'const a = b < c && d > e;');
    expect(html).not.toMatch(/<(?!\/?span)/); // only <span> tags, no raw < from source
  });
});
