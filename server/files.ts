import { existsSync, watch as fsWatch } from 'node:fs';
import { lstat, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

export class FsError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 413 = 400) {
    super(message);
    this.name = 'FsError';
  }
}

export type TreeEntry = { path: string; type: 'file' | 'dir'; size: number };
export type FileResult = {
  path: string; size: number; mtimeMs: number;
  binary: boolean; content?: string; encoding?: 'base64';
};

const WIN_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

export async function resolveRoot(input: string): Promise<string> {
  if (!input || !isAbsolute(input)) throw new FsError('Root must be an absolute path.');
  let dirReal: string;
  try {
    const st = await stat(input);
    if (!st.isDirectory()) throw new FsError('Root is not a directory.');
    dirReal = await realpath(input);
  } catch (e) {
    if (e instanceof FsError) throw e;
    throw new FsError('Root does not exist.', 404);
  }
  if (basename(dirReal) === '.github') return dirReal;
  const candidate = resolve(dirReal, '.github');
  try {
    if ((await stat(candidate)).isDirectory()) return await realpath(candidate);
  } catch { /* fall through to error */ }
  throw new FsError('No .github folder found at that path.');
}

// case-insensitive on win32, separator-aware so C:\foo does not match C:\foobar
function isWithin(root: string, target: string): boolean {
  const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const r = norm(resolve(root));
  const t = norm(resolve(target));
  return t === r || t.startsWith(r.endsWith(sep) ? r : r + sep);
}

// realpath the deepest existing ancestor, then re-attach the non-existing tail.
async function realpathDeepest(p: string): Promise<string> {
  let cur = p;
  for (;;) {
    try {
      const real = await realpath(cur);
      return real + p.slice(cur.length);
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return p; // nothing on the path exists
      cur = parent;
    }
  }
}

export async function containedPath(root: string, rel: string): Promise<string> {
  if (!rel) throw new FsError('Path is empty.');
  const normal = rel.replace(/\\/g, '/');
  if (isAbsolute(normal) || /^[a-zA-Z]:/.test(normal)) throw new FsError('Path must be relative.');
  const segments = normal.split('/').filter((s) => s !== '.');
  if (segments.length === 0) throw new FsError('Path is empty.');
  for (const seg of segments) {
    if (seg === '' || seg === '..') throw new FsError('Path escapes the root.');
    if (seg.includes(':')) throw new FsError('Illegal ":" in path (ADS / drive-relative).');
    if (/[. ]$/.test(seg)) throw new FsError('Path segment ends with a dot or space.');
    if (WIN_RESERVED.test(seg)) throw new FsError('Reserved device name in path.');
  }
  const resolved = resolve(root, segments.join('/'));
  if (!isWithin(root, resolved)) throw new FsError('Path escapes the root.');
  const real = await realpathDeepest(resolved);
  if (!isWithin(root, real)) throw new FsError('Path escapes the root through a link.');
  return resolved;
}

const MAX_ENTRIES = 2000;
const MAX_READ_BYTES = 1024 * 1024;
const isNoise = (name: string) => name === 'node_modules' || name === '.git';

export async function listTree(root: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const entries: TreeEntry[] = [];
  let truncated = false;
  const walk = async (absDir: string, relDir: string): Promise<void> => {
    if (truncated) return;
    let dirents;
    try { dirents = await readdir(absDir, { withFileTypes: true }); } catch { return; }
    const sorted = dirents.slice().sort((a, b) =>
      (a.isDirectory() ? 0 : 1) - (b.isDirectory() ? 0 : 1) || a.name.localeCompare(b.name));
    for (const d of sorted) {
      if (isNoise(d.name)) continue;
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      const abs = join(absDir, d.name);
      let st;
      try { st = await lstat(abs); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (entries.length >= MAX_ENTRIES) { truncated = true; return; }
        entries.push({ path: rel, type: 'dir', size: 0 });
        await walk(abs, rel);
        if (truncated) return;
      } else if (st.isFile()) {
        if (entries.length >= MAX_ENTRIES) { truncated = true; return; }
        entries.push({ path: rel, type: 'file', size: st.size });
      }
    }
  };
  await walk(root, '');
  return { entries, truncated };
}

export async function readFileSafe(root: string, rel: string): Promise<FileResult> {
  const abs = await containedPath(root, rel);
  let st;
  try { st = await lstat(abs); } catch { throw new FsError('File not found.', 404); }
  if (st.isSymbolicLink() || !st.isFile()) throw new FsError('Not a regular file.');
  if (st.size > MAX_READ_BYTES) throw new FsError('File exceeds the 1 MiB view limit.', 400);
  const buf = await readFile(abs);
  const binary = buf.subarray(0, 8192).includes(0);
  if (binary) {
    return { path: rel, size: st.size, mtimeMs: st.mtimeMs, binary: true, content: buf.toString('base64'), encoding: 'base64' };
  }
  return { path: rel, size: st.size, mtimeMs: st.mtimeMs, binary: false, content: buf.toString('utf8') };
}

export async function writeFileSafe(root: string, rel: string, content: string): Promise<{ mtimeMs: number }> {
  if (!/\.ya?ml$/i.test(rel)) throw new FsError('Only .yml/.yaml files can be written.');
  const abs = await containedPath(root, rel);
  const parent = dirname(abs);
  let pst;
  try { pst = await stat(parent); } catch { throw new FsError('Parent directory does not exist.'); }
  if (!pst.isDirectory()) throw new FsError('Parent is not a directory.');
  const tmp = `${abs}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, abs); // atomic replace-over-existing (probe-confirmed on Windows)
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e instanceof FsError ? e : new FsError('Failed to write file.');
  }
  return { mtimeMs: (await stat(abs)).mtimeMs };
}

export type WatcherLike = { close(): void; on(event: 'error', cb: (e: unknown) => void): void };
export type WatchFn = (
  path: string,
  opts: { recursive: boolean },
  listener: (eventType: string, filename: string | null) => void,
) => WatcherLike;

export function createWatcher(
  root: string,
  onBatch: (paths: string[]) => void,
  onError: (message: string) => void,
  watchFn: WatchFn = fsWatch as unknown as WatchFn,
  debounceMs = 250,
): { close(): void } {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Set<string>();
  let watcher: WatcherLike;

  const close = () => {
    if (closed) return;
    closed = true;
    if (timer) { clearTimeout(timer); timer = null; }
    try { watcher.close(); } catch { /* ignore */ }
  };
  const flush = () => {
    timer = null;
    if (closed || pending.size === 0) return;
    const paths = [...pending];
    pending.clear();
    onBatch(paths);
  };
  const fail = (message: string) => {
    if (closed) return;
    close();
    onError(message);
  };

  watcher = watchFn(root, { recursive: true }, (_type, filename) => {
    if (closed) return;
    // Root death fires NO error event — the watcher busy-loops with filename = the
    // absolute \\?\C:\... path (probe-confirmed). Self-detect and close.
    if (filename === null || isAbsolute(filename) || filename.startsWith('\\\\?\\') || !existsSync(root)) {
      fail('Watched folder was removed.');
      return;
    }
    const rel = filename.replace(/\\/g, '/');
    if (rel.split('/').some(isNoise)) return;
    pending.add(rel);
    if (!timer) timer = setTimeout(flush, debounceMs);
  });
  watcher.on('error', () => fail('Watcher error.')); // belt-and-braces
  return { close };
}
