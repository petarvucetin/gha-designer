process.env.RUNNER_AUTOSTART = '0';

import { join } from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startServer } from './index';
import type { WatchFn } from './files';

let srv: Awaited<ReturnType<typeof startServer>>;
const NODE = process.execPath;
const MOCK = join(__dirname, 'mock-act.mjs');
const FIXTURE = join(__dirname, 'fixtures', 'dryrun.jsonl');

beforeAll(async () => {
  process.env.ACT_BINARY = NODE;
  process.env.ACT_PREFIX_ARGS = MOCK;
  process.env.MOCK_ACT_FIXTURE = FIXTURE;
  srv = await startServer(0);
});
afterAll(async () => {
  delete process.env.ACT_BINARY;
  delete process.env.ACT_PREFIX_ARGS;
  delete process.env.MOCK_ACT_FIXTURE;
  await srv.close();
});

const url = (p: string) => `http://127.0.0.1:${srv.port}${p}`;
const runBody = () => JSON.stringify({
  workflows: [{ fileName: 'ci.yml', yaml: 'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ls' }],
  target: 'ci.yml', event: 'push', engine: 'docker', image: 'node:20-bookworm-slim', pull: false,
});

describe('runner http api', () => {
  it('health + engines respond', async () => {
    expect((await fetch(url('/api/health'))).status).toBe(200);
    const engines = await (await fetch(url('/api/engines'))).json();
    expect(engines).toHaveProperty('act');
  });

  it('403s foreign origins and 415s text/plain posts', async () => {
    const forged = await fetch(url('/api/runs'), { method: 'POST', headers: { origin: 'https://evil.com', 'content-type': 'application/json' }, body: runBody() });
    expect(forged.status).toBe(403);
    const plain = await fetch(url('/api/runs'), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: runBody() });
    expect(plain.status).toBe(415);
  });

  it('starts a run and streams SSE to completion', async () => {
    const res = await fetch(url('/api/runs'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: runBody() });
    expect(res.status).toBe(200);
    const { runId } = await res.json();
    const sse = await fetch(url(`/api/runs/${runId}/events`));
    const text = await sse.text(); // stream ends with event: end
    expect(text).toContain('"kind":"status"');
    expect(text).toContain('event: end');
  });

  it('400s invalid bodies', async () => {
    const res = await fetch(url('/api/runs'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"nope": true}' });
    expect(res.status).toBe(400);
  });

  it('400s a run request whose target escapes .github/workflows or has no yml/yaml extension', async () => {
    const body = JSON.parse(runBody());
    const traversal = await fetch(url('/api/runs'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, target: '../evil.yml' }),
    });
    expect(traversal.status).toBe(400);
    expect((await traversal.json()).error).toMatch(/Invalid run request/);

    const noExt = await fetch(url('/api/runs'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, target: 'noext' }),
    });
    expect(noExt.status).toBe(400);
    expect((await noExt.json()).error).toMatch(/Invalid run request/);
  });

  it('413s a POST body over the 10MB cap', async () => {
    const huge = 'x'.repeat(10 * 1024 * 1024 + 1);
    const res = await fetch(url('/api/runs'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: huge });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'Body too large.' });
  });

  it('404s cancelling an unknown run', async () => {
    const res = await fetch(url('/api/runs/does-not-exist/cancel'), { method: 'POST', headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(404);
  });

  // Extended timeout: the vm engine path shells out to a real `ssh`/`scp` against
  // runner@127.0.0.1 (no such host is actually listening), and each of those real
  // connection attempts takes multiple seconds to fail — well past vitest's 5s default.
  it('engines report includes vm; vm run request is accepted', async () => {
    process.env.VM_SSH_TARGET = 'runner@127.0.0.1'; process.env.VM_SSH_KEY = 'k';
    const { port, close } = await startServer(0);
    try {
      const eng = await (await fetch(`http://127.0.0.1:${port}/api/engines`, { headers: { origin: `http://127.0.0.1:${port}` } })).json();
      expect(eng).toHaveProperty('vm');
      const res = await fetch(`http://127.0.0.1:${port}/api/runs`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
        body: JSON.stringify({ workflows: [{ fileName: 'ci.yml', yaml: 'on: push' }], target: 'ci.yml', event: 'push', engine: 'vm', mode: 'self-hosted', image: 'x', pull: false }),
      });
      expect([200, 400].includes(res.status)).toBe(true); // accepted by validation (may 400 later if ssh missing, but NOT a validation reject)
      const body = await res.json();
      // body.error is absent on the 200 (runId) path — only assert on it when present, since
      // .not.toMatch() throws (rather than failing) on a non-string/undefined actual value.
      expect(body.error ?? '').not.toMatch(/Invalid run request/);
    } finally { delete process.env.VM_SSH_TARGET; delete process.env.VM_SSH_KEY; await close(); }
  }, 30000);

  it('replays a finished run on a second SSE GET instead of crashing the server', async () => {
    const res = await fetch(url('/api/runs'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: runBody() });
    expect(res.status).toBe(200);
    const { runId } = await res.json();

    // Drive the run to completion via its first SSE stream.
    const first = await fetch(url(`/api/runs/${runId}/events`));
    const firstText = await first.text();
    expect(firstText).toContain('event: end');

    // The run is now finished; a second GET must replay the buffered history synchronously
    // via `manager.subscribe`, not crash the process (this used to throw a TDZ
    // ReferenceError on the terminal 'phase' event and take the server down with an
    // unhandled ERR_HTTP_HEADERS_SENT rejection).
    const replay = await fetch(url(`/api/runs/${runId}/events`));
    expect(replay.status).toBe(200);
    const replayText = await replay.text();
    expect(replayText).toContain('"kind":"status"');
    expect(replayText).toContain('event: end');

    // The server process must still be alive and serving requests.
    expect((await fetch(url('/api/health'))).status).toBe(200);
  });

  it('accepts a string sourceRoot, rejects a non-string one', async () => {
    const base = await mkGithub();
    try {
      const withRoot = await fetch(url('/api/runs'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(runBody()), sourceRoot: base }),
      });
      expect(withRoot.status).toBe(200); // sourceRoot as a string is not a validation reject
      expect((await withRoot.json()).error).toBeUndefined();

      const badRoot = await fetch(url('/api/runs'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(runBody()), sourceRoot: 42 }),
      });
      expect(badRoot.status).toBe(400);
      expect((await badRoot.json()).error).toMatch(/Invalid run request/);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

async function mkGithub(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'ghafs-route-'));
  await mkdir(join(base, '.github', 'workflows'), { recursive: true });
  await writeFile(join(base, '.github', 'workflows', 'ci.yml'), 'on: push\n', 'utf8');
  return base;
}
function fakeWatchFactory() {
  const watchers: { closed: boolean; emit: (t: string, f: string | null) => void }[] = [];
  const watchFn: WatchFn = (_p, _o, listener) => {
    const w = { closed: false, emit: (t: string, f: string | null) => listener(t, f),
      close() { this.closed = true; }, on() {} };
    watchers.push(w);
    return w;
  };
  return { watchFn, watchers };
}

describe('fs api', () => {
  it('serves the tree and a file, and 400s a containment escape', async () => {
    const base = await mkGithub();
    const tree = await (await fetch(url(`/api/fs/tree?root=${encodeURIComponent(base)}`))).json();
    expect(tree.entries.map((e: { path: string }) => e.path)).toContain('workflows/ci.yml');
    const file = await (await fetch(url(`/api/fs/file?root=${encodeURIComponent(base)}&path=workflows/ci.yml`))).json();
    expect(file.content).toContain('on: push');
    const esc = await fetch(url(`/api/fs/file?root=${encodeURIComponent(base)}&path=../../escape.yml`));
    expect(esc.status).toBe(400);
    const bad = await fetch(url('/api/fs/tree?root=relative'));
    expect(bad.status).toBe(400);
    await rm(base, { recursive: true, force: true });
  });

  it('PUTs a workflow, 415s a text/plain PUT, and 413s a body over 2 MiB', async () => {
    const base = await mkGithub();
    const ok = await fetch(url('/api/fs/file'), {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: base, path: 'workflows/ci.yml', content: 'on: pull_request\n' }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).mtimeMs).toBeTypeOf('number');
    const plain = await fetch(url('/api/fs/file'), { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect(plain.status).toBe(415);
    const huge = JSON.stringify({ root: base, path: 'workflows/ci.yml', content: 'x'.repeat(2 * 1024 * 1024 + 1) });
    const big = await fetch(url('/api/fs/file'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: huge });
    expect(big.status).toBe(413);
    await rm(base, { recursive: true, force: true });
  });

  it('SSE validates the root BEFORE headers (JSON 400 on a dead root)', async () => {
    const res = await fetch(url('/api/fs/events?root=relative'));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('SSE emits a terminal fs-error on root death and closes the watcher', async () => {
    const fake = fakeWatchFactory();
    const s2 = await startServer(0, { watchFn: fake.watchFn });
    const base = await mkGithub();
    const p = fetch(`http://127.0.0.1:${s2.port}/api/fs/events?root=${encodeURIComponent(base)}`);
    await vi.waitFor(() => expect(fake.watchers).toHaveLength(1));
    fake.watchers[0].emit('rename', 'C:\\Users\\x\\.github'); // absolute → root death
    const text = await (await p).text();
    expect(text).toContain('"kind":"fs-error"');
    expect(text).toContain('event: end');
    expect(fake.watchers[0].closed).toBe(true);
    await s2.close();
    await rm(base, { recursive: true, force: true });
  });

  it('closes the watcher when the SSE client disconnects', async () => {
    const fake = fakeWatchFactory();
    const s2 = await startServer(0, { watchFn: fake.watchFn });
    const base = await mkGithub();
    const ac = new AbortController();
    const p = fetch(`http://127.0.0.1:${s2.port}/api/fs/events?root=${encodeURIComponent(base)}`, { signal: ac.signal });
    await vi.waitFor(() => expect(fake.watchers).toHaveLength(1));
    ac.abort();
    await p.catch(() => {});
    await vi.waitFor(() => expect(fake.watchers[0].closed).toBe(true));
    await s2.close();
    await rm(base, { recursive: true, force: true });
  });
});
