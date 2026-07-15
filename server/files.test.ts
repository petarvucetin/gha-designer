import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { readFile as fsRead } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { containedPath, resolveRoot, FsError, listTree, readFileSafe, writeFileSafe, createWatcher, type WatchFn } from './files';
import { vi } from 'vitest';

let base: string;      // a temp dir that IS a repo root (contains .github)
let root: string;      // the canonical .github root
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'ghafs-'));
  await mkdir(join(base, '.github', 'workflows'), { recursive: true });
  await writeFile(join(base, '.github', 'workflows', 'ci.yml'), 'on: push\n', 'utf8');
  root = await resolveRoot(base);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

describe('resolveRoot', () => {
  it('accepts a repo dir (adds .github) and a .github dir (itself)', async () => {
    expect(root.toLowerCase().endsWith('.github')).toBe(true);
    expect((await resolveRoot(join(base, '.github'))).toLowerCase()).toBe(root.toLowerCase());
  });
  it('rejects relative, missing, and no-.github paths', async () => {
    await expect(resolveRoot('workflows')).rejects.toBeInstanceOf(FsError);
    await expect(resolveRoot(join(base, 'nope'))).rejects.toBeInstanceOf(FsError);
    const empty = await mkdtemp(join(tmpdir(), 'ghafs-empty-'));
    await expect(resolveRoot(empty)).rejects.toBeInstanceOf(FsError);
    await rm(empty, { recursive: true, force: true });
  });
});

describe('containedPath', () => {
  it('resolves a clean rel path under the root', async () => {
    const p = await containedPath(root, 'workflows/ci.yml');
    expect(p.toLowerCase()).toBe(join(root, 'workflows', 'ci.yml').toLowerCase());
  });
  it('normalizes backslashes and is case-insensitive on win32', async () => {
    await expect(containedPath(root, 'workflows\\ci.yml')).resolves.toContain('ci.yml');
  });
  it('rejects .., absolute rel, drive letters, and the C:\\foo vs C:\\foobar prefix trick', async () => {
    await expect(containedPath(root, '../secrets.txt')).rejects.toBeInstanceOf(FsError);
    await expect(containedPath(root, 'workflows/../../escape.yml')).rejects.toBeInstanceOf(FsError);
    await expect(containedPath(root, '/etc/passwd')).rejects.toBeInstanceOf(FsError);
    await expect(containedPath(root, 'C:/Windows/System32/x.yml')).rejects.toBeInstanceOf(FsError);
    await expect(containedPath(`${root}foo`, 'x.yml')).resolves.toBeTruthy(); // sanity: sibling root is its own root
  });
  it('rejects ADS colons, reserved device names, and trailing dot/space segments', async () => {
    await expect(containedPath(root, 'workflows/ci.yml:evil')).rejects.toBeInstanceOf(FsError);
    await expect(containedPath(root, 'workflows/CON')).rejects.toBeInstanceOf(FsError);
    await expect(containedPath(root, 'workflows/COM1.yml')).rejects.toBeInstanceOf(FsError);
    await expect(containedPath(root, 'workflows/lpt9')).rejects.toBeInstanceOf(FsError);
    await expect(containedPath(root, 'workflows/foo ')).rejects.toBeInstanceOf(FsError);
    await expect(containedPath(root, 'workflows/foo.')).rejects.toBeInstanceOf(FsError);
  });
  it('rejects a junction/symlink middle segment that escapes the root (physical phase)', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'ghafs-out-'));
    await writeFile(join(outside, 'loot.yml'), 'x: 1\n', 'utf8');
    try {
      // junction on Windows, dir symlink elsewhere; both resolve outside the root
      await symlink(outside, join(root, 'link'), 'junction').catch(async () => {
        await symlink(outside, join(root, 'link'), 'dir');
      });
      await expect(containedPath(root, 'link/loot.yml')).rejects.toBeInstanceOf(FsError);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('listTree', () => {
  it('excludes node_modules/.git before the cap, skips symlinks, forward-slash rel, dirs-first', async () => {
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'pkg', 'x.js'), '1', 'utf8');
    await mkdir(join(root, '.git'), { recursive: true });
    await writeFile(join(root, '.git', 'HEAD'), 'ref', 'utf8');
    await writeFile(join(root, 'dependabot.yml'), 'v: 2\n', 'utf8');
    const { entries, truncated } = await listTree(root);
    const paths = entries.map((e) => e.path);
    expect(truncated).toBe(false);
    expect(paths).toContain('workflows');
    expect(paths).toContain('workflows/ci.yml');
    expect(paths).toContain('dependabot.yml');
    expect(paths.some((p) => p.startsWith('node_modules'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.git'))).toBe(false);
    expect(paths.every((p) => !p.includes('\\'))).toBe(true);
    expect(entries.find((e) => e.path === 'workflows')?.type).toBe('dir');
  });
  it('truncation engages at the cap and exclusion happens before the cap', async () => {
    await mkdir(join(root, 'many'), { recursive: true });
    for (let i = 1; i <= 2050; i++) {
      const num = String(i).padStart(4, '0');
      await writeFile(join(root, 'many', `f${num}.txt`), '', 'utf8');
    }
    await mkdir(join(root, 'node_modules'), { recursive: true });
    for (let i = 0; i < 30; i++) {
      await writeFile(join(root, 'node_modules', `pkg${i}.txt`), '', 'utf8');
    }
    const { entries, truncated } = await listTree(root);
    const paths = entries.map((e) => e.path);
    expect(truncated).toBe(true);
    expect(entries.length).toBe(2000);
    expect(paths.some((p) => p.startsWith('node_modules'))).toBe(false);
  });
});

describe('readFileSafe', () => {
  it('reads utf8 text (no encoding field)', async () => {
    const r = await readFileSafe(root, 'workflows/ci.yml');
    expect(r.binary).toBe(false);
    expect(r.content).toContain('on: push');
    expect(r.encoding).toBeUndefined();
  });
  it('base64-encodes a file with a NUL in the first 8 KiB', async () => {
    await writeFile(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
    const r = await readFileSafe(root, 'logo.png');
    expect(r.binary).toBe(true);
    expect(r.encoding).toBe('base64');
    expect(Buffer.from(r.content!, 'base64')[2]).toBe(0x00);
  });
  it('404s a missing file and 400s a file over 1 MiB', async () => {
    await expect(readFileSafe(root, 'workflows/ghost.yml')).rejects.toMatchObject({ status: 404 });
    await writeFile(join(root, 'big.yml'), 'x'.repeat(1024 * 1024 + 1), 'utf8');
    await expect(readFileSafe(root, 'big.yml')).rejects.toMatchObject({ status: 400 });
  });
  it('rejects a non-regular file (directory)', async () => {
    await expect(readFileSafe(root, 'workflows')).rejects.toBeInstanceOf(FsError);
    await expect(readFileSafe(root, 'workflows')).rejects.toMatchObject({ status: 400 });
  });
});

describe('writeFileSafe', () => {
  it('writes yml atomically and returns mtimeMs', async () => {
    const { mtimeMs } = await writeFileSafe(root, 'workflows/new.yml', 'on: push\n');
    expect(typeof mtimeMs).toBe('number');
    expect(await fsRead(join(root, 'workflows', 'new.yml'), 'utf8')).toBe('on: push\n');
  });
  it('rejects non-yml and a missing parent directory', async () => {
    await expect(writeFileSafe(root, 'workflows/readme.md', '#')).rejects.toBeInstanceOf(FsError);
    await expect(writeFileSafe(root, 'nope/deep/x.yml', 'a: 1')).rejects.toBeInstanceOf(FsError);
  });
  it('leaves no .tmp file behind on a failed write', async () => {
    await expect(writeFileSafe(root, 'nope/x.yml', 'a')).rejects.toBeTruthy();
    const { entries } = await listTree(root);
    expect(entries.some((e) => e.path.endsWith('.tmp'))).toBe(false);
  });
  it('overwrites an existing target and returns updated mtimeMs', async () => {
    await writeFile(join(root, 'workflows', 'existing.yml'), 'old', 'utf8');
    const { mtimeMs } = await writeFileSafe(root, 'workflows/existing.yml', 'new: 1\n');
    expect(typeof mtimeMs).toBe('number');
    expect(await fsRead(join(root, 'workflows', 'existing.yml'), 'utf8')).toBe('new: 1\n');
    const { entries } = await listTree(root);
    expect(entries.some((e) => e.path.endsWith('.tmp'))).toBe(false);
  });
});

function fakeWatch() {
  let listener: (t: string, f: string | null) => void = () => {};
  const w = { closed: false, onErr: undefined as undefined | ((e: unknown) => void),
    close() { this.closed = true; }, on(_e: 'error', cb: (e: unknown) => void) { w.onErr = cb; } };
  const watchFn: WatchFn = (_p, _o, l) => { listener = l; return w; };
  return { watchFn, emit: (t: string, f: string | null) => listener(t, f), w };
}

describe('createWatcher', () => {
  it('debounces + dedupes a burst into one slash-normalized noise-free batch', async () => {
    vi.useFakeTimers();
    const f = fakeWatch();
    const batches: string[][] = [];
    createWatcher(root, (p) => batches.push(p), () => {}, f.watchFn, 250);
    f.emit('change', 'workflows\\ci.yml');
    f.emit('rename', 'workflows\\ci.yml');
    f.emit('change', 'workflows\\deploy.yml');
    f.emit('change', 'node_modules\\pkg\\x.js'); // dropped
    expect(batches).toHaveLength(0);
    vi.advanceTimersByTime(250);
    expect(batches).toEqual([['workflows/ci.yml', 'workflows/deploy.yml']]);
    vi.useRealTimers();
  });
  it('self-detects root death (absolute filename) — closes once and calls onError once', () => {
    const f = fakeWatch();
    const errs: string[] = [];
    const h = createWatcher(root, () => {}, (m) => errs.push(m), f.watchFn, 250);
    f.emit('rename', 'C:\\Users\\x\\.github'); // absolute → root death
    f.emit('rename', 'C:\\Users\\x\\.github'); // busy-loop follow-up: ignored
    expect(f.w.closed).toBe(true);
    expect(errs).toHaveLength(1);
    h.close(); // idempotent
    expect(errs).toHaveLength(1);
  });
  it('treats a null filename as root death and the error event as belt-and-braces', () => {
    const f1 = fakeWatch();
    const e1: string[] = [];
    createWatcher(root, () => {}, (m) => e1.push(m), f1.watchFn);
    f1.emit('rename', null);
    expect(e1).toHaveLength(1);
    const f2 = fakeWatch();
    const e2: string[] = [];
    createWatcher(root, () => {}, (m) => e2.push(m), f2.watchFn);
    f2.w.onErr?.(new Error('boom'));
    expect(e2).toHaveLength(1);
    expect(f2.w.closed).toBe(true);
  });
});
