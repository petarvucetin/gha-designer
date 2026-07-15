import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanupWorkspace, runsRoot, writeWorkspace } from './workspace';

describe('workspace', () => {
  it('writes every workflow, git-inits with a commit, and never writes secret files', async () => {
    const id = `test-${Date.now()}`;
    const dir = await writeWorkspace(id, [
      { fileName: 'a.yml', yaml: 'on: push' },
      { fileName: 'b.yml', yaml: 'on: push' },
    ]);
    expect(readFileSync(join(dir, '.github', 'workflows', 'a.yml'), 'utf8')).toBe('on: push');
    expect(existsSync(join(dir, '.github', 'workflows', 'b.yml'))).toBe(true);
    expect(existsSync(join(dir, '.git'))).toBe(true);
    expect(existsSync(join(dir, '.secrets'))).toBe(false);
    expect(existsSync(join(dir, '.env'))).toBe(false);
    await cleanupWorkspace(id);
    expect(existsSync(dir)).toBe(false);
  });

  it('writes event.json only when a payload is given', async () => {
    const id = `test-ev-${Date.now()}`;
    const dir = await writeWorkspace(id, [{ fileName: 'a.yml', yaml: 'on: push' }], { eventPayload: { ref: 'refs/heads/main' } });
    expect(JSON.parse(readFileSync(join(dir, 'event.json'), 'utf8')).ref).toBe('refs/heads/main');
    await cleanupWorkspace(id);
  });

  it('rejects traversal-hostile names defensively', async () => {
    await expect(writeWorkspace(`t-${Date.now()}`, [{ fileName: '..\\evil.yml', yaml: '' }])).rejects.toThrow();
  });

  it('exposes the runs root for the sweeper', () => {
    expect(runsRoot()).toContain('gha-designer-runs');
  });

  it('rejects an empty workflow list before touching the filesystem', async () => {
    const id = `test-empty-${Date.now()}`;
    await expect(writeWorkspace(id, [])).rejects.toThrow(/workflow/i);
    expect(existsSync(join(runsRoot(), id))).toBe(false);
  });
});

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'repo-'));
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'on: push  # ON DISK', 'utf8');
  mkdirSync(join(root, 'runner-image'), { recursive: true });
  writeFileSync(join(root, 'runner-image', 'Containerfile'), 'FROM alpine', 'utf8');
  mkdirSync(join(root, 'node_modules', 'junk'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'junk', 'big.js'), 'x', 'utf8');
  return root;
}

describe('writeWorkspace sourceRoot staging', () => {
  it('copies the repo (excluding node_modules), overlays composed workflows', async () => {
    const repo = makeRepo();
    const dir = await writeWorkspace('t-stage-1',
      [{ fileName: 'ci.yml', yaml: 'on: push  # COMPOSED' }],
      { sourceRoot: repo });
    try {
      expect(existsSync(join(dir, 'runner-image', 'Containerfile'))).toBe(true);       // repo file staged
      expect(existsSync(join(dir, 'node_modules'))).toBe(false);                        // noise excluded
      expect(readFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'utf8')).toContain('COMPOSED'); // overlay wins
    } finally { await cleanupWorkspace('t-stage-1'); }
  });
  it('rejects a sourceRoot with no .github (containment)', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'bare-'));
    await expect(writeWorkspace('t-stage-2', [{ fileName: 'ci.yml', yaml: 'on: push' }], { sourceRoot: bare }))
      .rejects.toThrow();
    await cleanupWorkspace('t-stage-2');
  });
  it('no sourceRoot → workflows-only (backward compatible)', async () => {
    const dir = await writeWorkspace('t-stage-3', [{ fileName: 'ci.yml', yaml: 'on: push' }]);
    try { expect(existsSync(join(dir, 'runner-image'))).toBe(false); } finally { await cleanupWorkspace('t-stage-3'); }
  });
  it('skips build-cache dirs (e.g. packer_cache) while staging real repo files', async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, 'vm', 'packer', 'packer_cache'), { recursive: true });
    writeFileSync(join(repo, 'vm', 'packer', 'packer_cache', 'big.iso'), 'not-actually-3gb', 'utf8');
    const dir = await writeWorkspace('t-stage-4',
      [{ fileName: 'ci.yml', yaml: 'on: push' }],
      { sourceRoot: repo });
    try {
      expect(existsSync(join(dir, 'runner-image', 'Containerfile'))).toBe(true); // real repo file staged
      expect(existsSync(join(dir, 'vm', 'packer', 'packer_cache'))).toBe(false); // build-cache dir skipped
    } finally { await cleanupWorkspace('t-stage-4'); }
  });
});
