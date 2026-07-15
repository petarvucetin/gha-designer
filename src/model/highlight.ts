// Syntax highlighting for the read-only file viewer, keyed by file extension.
//
// We register only the languages a real repository's .github folder (and the files a
// user is likely to click through) actually contains, rather than pulling highlight.js's
// full ~200-language bundle. Unknown extensions fall back to escaped plain text so the
// viewer stays readable (the theme's base `.hljs` color still applies) without inventing
// colors the user didn't ask for.

import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  const langs: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
    bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json,
    markdown, php, powershell, python, ruby, rust, shell, sql, typescript, xml, yaml,
  };
  for (const [name, lang] of Object.entries(langs)) hljs.registerLanguage(name, lang);
}

// Extension → registered language. Aliases collapse to the closest registered grammar
// (tsx→typescript, toml/cfg→ini, htm→xml, etc.).
const EXT_LANG: Record<string, string> = {
  sh: 'bash', bash: 'bash', zsh: 'bash',
  c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',
  cs: 'csharp',
  css: 'css',
  diff: 'diff', patch: 'diff',
  go: 'go',
  ini: 'ini', toml: 'ini', cfg: 'ini', conf: 'ini', editorconfig: 'ini', properties: 'ini',
  java: 'java',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  json: 'json',
  md: 'markdown', markdown: 'markdown',
  php: 'php',
  ps1: 'powershell', psm1: 'powershell',
  py: 'python', pyi: 'python',
  rb: 'ruby',
  rs: 'rust',
  sql: 'sql',
  ts: 'typescript', tsx: 'typescript',
  xml: 'xml', html: 'xml', htm: 'xml', xhtml: 'xml', svg: 'xml',
  yml: 'yaml', yaml: 'yaml',
};

// Filenames with no extension (or where the name matters more than the extension).
const NAME_LANG: Record<string, string> = {
  dockerfile: 'dockerfile',
  '.gitignore': 'bash',
  '.gitattributes': 'bash',
  '.editorconfig': 'ini',
  '.npmrc': 'ini',
  '.env': 'bash',
  makefile: 'bash',
  gemfile: 'ruby',
  rakefile: 'ruby',
};

function baseName(path: string): string {
  const norm = path.replace(/\\/g, '/');
  return norm.slice(norm.lastIndexOf('/') + 1);
}

/** Registered highlight.js language for a path, or null when the extension is unknown. */
export function languageForPath(path: string): string | null {
  const name = baseName(path).toLowerCase();
  if (NAME_LANG[name]) return NAME_LANG[name];
  const dot = name.lastIndexOf('.');
  // No extension (dot at index 0 means a dotfile like `.gitignore`, handled by NAME_LANG above).
  if (dot <= 0) return null;
  return EXT_LANG[name.slice(dot + 1)] ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Highlight `code` for `path`. Returns the resolved language (null if unknown) and HTML
 * safe to inject into a `.hljs` element — highlight.js escapes the source before wrapping
 * tokens, and the unknown-language fallback escapes it here, so arbitrary file content
 * can never inject markup.
 */
export function highlightCode(path: string, code: string): { language: string | null; html: string } {
  const language = languageForPath(path);
  if (!language) return { language: null, html: escapeHtml(code) };
  ensureRegistered();
  try {
    return { language, html: hljs.highlight(code, { language, ignoreIllegals: true }).value };
  } catch {
    return { language: null, html: escapeHtml(code) };
  }
}
