import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile, readdir, stat, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { FILE_NAME_RE, validateFileNames } from './actArgs';
import { resolveRoot, listTree } from './files';

const execFileP = promisify(execFile);

export function runsRoot(): string {
  return join(tmpdir(), 'gha-designer-runs');
}

export function workspaceDir(runId: string): string {
  return join(runsRoot(), runId);
}

export async function writeWorkspace(
  runId: string,
  workflows: { fileName: string; yaml: string }[],
  opts: { eventPayload?: Record<string, unknown>; sourceRoot?: string } = {},
): Promise<string> {
  if (workflows.length === 0) throw new Error('writeWorkspace requires at least one workflow.');
  const err = validateFileNames(workflows);
  if (err) throw new Error(err);
  const dir = workspaceDir(runId);
  await mkdir(dir, { recursive: true });
  if (opts.sourceRoot) {
    const repoRoot = dirname(await resolveRoot(opts.sourceRoot)); // resolveRoot → <root>/.github; repo = its parent
    await copyRepoTree(repoRoot, dir);
  }
  const wfDir = join(dir, '.github', 'workflows');
  await mkdir(wfDir, { recursive: true });
  for (const { fileName, yaml } of workflows) {
    if (basename(fileName) !== fileName || !FILE_NAME_RE.test(fileName)) {
      throw new Error(`Invalid workflow file name "${fileName}".`);
    }
    await writeFile(join(wfDir, fileName), yaml, 'utf8'); // overlay: composed wins over on-disk
  }
  if (opts.eventPayload) {
    await writeFile(join(dir, 'event.json'), JSON.stringify(opts.eventPayload), 'utf8');
  }
  const git = (...args: string[]) => execFileP('git', ['-C', dir, ...args]);
  await git('init', '-q');
  await git('-c', 'user.email=runner@gha-designer.local', '-c', 'user.name=gha-designer', 'add', '-A');
  await git('-c', 'user.email=runner@gha-designer.local', '-c', 'user.name=gha-designer', 'commit', '-qm', 'run');
  return dir;
}

const STAGE_SKIP_DIRS = new Set([
  'packer_cache', 'output-hyperv', 'dist', 'build', 'target',
  '.venv', 'venv', '.next', '.cache', 'vendor', '.superpowers',
]);
const STAGE_MAX_FILE_BYTES = 100 * 1024 * 1024;   // skip any single file > 100 MiB
const STAGE_MAX_TOTAL_BYTES = 512 * 1024 * 1024;  // stop staging past 512 MiB total

async function copyRepoTree(repoRoot: string, dstDir: string): Promise<void> {
  const { entries, truncated } = await listTree(repoRoot); // excludes .git/node_modules, skips symlinks, caps 2000
  let total = 0, skipped = 0;
  for (const e of entries) {
    if (e.path.split('/').some((seg) => STAGE_SKIP_DIRS.has(seg))) { skipped++; continue; }
    const dst = join(dstDir, e.path);
    if (e.type === 'dir') { await mkdir(dst, { recursive: true }); continue; }
    if (e.size > STAGE_MAX_FILE_BYTES || total + e.size > STAGE_MAX_TOTAL_BYTES) { skipped++; continue; }
    total += e.size;
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(join(repoRoot, e.path), dst);
  }
  if (skipped) console.warn(`writeWorkspace: staged repo with ${skipped} entries skipped (build-cache dirs or byte caps).`);
  if (truncated) console.warn('writeWorkspace: repo staging hit the 2000-entry cap — some files were not staged.');
}

export async function cleanupWorkspace(runId: string): Promise<void> {
  await rm(workspaceDir(runId), { recursive: true, force: true });
}

export async function sweepOldWorkspaces(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
  const root = runsRoot();
  let entries: string[];
  try { entries = await readdir(root); } catch { return; }
  const now = Date.now();
  for (const entry of entries) {
    try {
      const s = await stat(join(root, entry));
      if (now - s.mtimeMs > maxAgeMs) await rm(join(root, entry), { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}
