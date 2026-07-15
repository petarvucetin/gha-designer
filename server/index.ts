import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { FILE_NAME_RE } from './actArgs';
import { createEngineCache, detectEngines, resolveActBinary } from './engines';
import { createWatcher, listTree, readFileSafe, resolveRoot, writeFileSafe, FsError, type WatchFn } from './files';
import { checkRequest } from './guard';
import { extractDefaultBranch, extractFromMarketplaceHtml, parseGithubUrl } from './resolveRef';
import { createRunManager } from './runManager';
import { resolveSetupAction, SETUP_ACTION_FALLBACK, type SafeCommand } from './setupActions';
import type { ExecFn, RunRequest } from './types';
import { loadVmConfig } from './vmTransport';
import { sweepOldWorkspaces } from './workspace';

// Validated owner/repo shape — required before building a `https://github.com/<repo>` URL
// from a value scraped out of untrusted page HTML (SSRF path safety).
const GITHUB_REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** Fetch a github.com page with a bounded timeout and a UA header. Caller must only ever
 * pass github.com URLs built from validated segments — this performs no host checking. */
async function fetchGithubPage(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: { 'user-agent': 'gha-designer' }, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

const execFileP = promisify(execFile);
const exec: ExecFn = async (cmd, args, env, cwd) => {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, { windowsHide: true, env: env ?? process.env, cwd });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

function isRunRequest(v: unknown): v is RunRequest {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return Array.isArray(r.workflows) && r.workflows.length > 0
    && typeof r.target === 'string' && FILE_NAME_RE.test(r.target) && typeof r.event === 'string'
    && (r.engine === 'docker' || r.engine === 'podman' || r.engine === 'vm')
    && (r.mode === undefined || r.mode === 'self-hosted' || r.mode === 'container')
    && typeof r.image === 'string' && typeof r.pull === 'boolean'
    && (r.sourceRoot === undefined || typeof r.sourceRoot === 'string');
}

export async function startServer(port = 7791, deps: { watchFn?: WatchFn } = {}) {
  const vmConfig = loadVmConfig(process.env);
  const engineCache = createEngineCache(() => detectEngines(exec, process.platform, vmConfig));
  const actPath = process.env.ACT_BINARY ?? (await resolveActBinary(exec)) ?? 'act';
  const prefix = process.env.ACT_PREFIX_ARGS ? [process.env.ACT_PREFIX_ARGS] : [];
  const mockEnv = process.env.MOCK_ACT_FIXTURE ? { MOCK_ACT_FIXTURE: process.env.MOCK_ACT_FIXTURE } : undefined;
  const manager = createRunManager({
    actPath, actPrefixArgs: prefix, exec, mockEnv,
    podmanSocket: async () => (await engineCache.get()).podman.socket,
    vmConfig: vmConfig ?? undefined,
  });
  void sweepOldWorkspaces();

  const server = createServer(async (req, res) => {
    const guard = checkRequest({ method: req.method ?? 'GET', headers: req.headers });
    if (!guard.ok) {
      res.writeHead(guard.code, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: guard.message }));
      return;
    }
    const sendJson = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const sendFsError = (e: unknown) => {
      const status = e instanceof FsError ? e.status : 400;
      sendJson(status, { error: e instanceof Error ? e.message : 'Filesystem error.' });
    };
    const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
    const path = (req.url ?? '/').split('?')[0];
    try {
      if (req.method === 'GET' && path === '/api/health') {
        return sendJson(200, { ok: true });
      }
      if (req.method === 'GET' && path === '/api/engines') {
        return sendJson(200, await engineCache.get());
      }
      if (req.method === 'GET' && path === '/api/runs') {
        return sendJson(200, manager.list());
      }
      if (req.method === 'POST' && path === '/api/runs') {
        const MAX_BODY_BYTES = 10 * 1024 * 1024;
        const chunks: Buffer[] = [];
        let bodyBytes = 0;
        for await (const c of req) {
          const chunk = c as Buffer;
          bodyBytes += chunk.length;
          if (bodyBytes > MAX_BODY_BYTES) {
            // Don't req.destroy() here: killing the socket before the response is flushed
            // races the client's still-in-flight upload and can tear down the connection
            // before it ever reads the 413 (observed as ECONNRESET/"other side closed" on
            // the client). Just stop reading — Node drains/closes the connection itself
            // once the response finishes without the request body having been consumed.
            return sendJson(413, { error: 'Body too large.' });
          }
          chunks.push(chunk);
        }
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return sendJson(400, { error: 'Invalid JSON.' }); }
        if (!isRunRequest(body)) return sendJson(400, { error: 'Invalid run request.' });
        try {
          return sendJson(200, await manager.start(body));
        } catch (err) {
          const e = err as { code?: number; activeRunId?: string; message?: string };
          if (e.code === 409) return sendJson(409, { error: 'A run is already active.', activeRunId: e.activeRunId });
          return sendJson(400, { error: e.message ?? 'Failed to start run.' });
        }
      }
      if (req.method === 'POST' && path === '/api/resolve-ref') {
        const MAX_BODY_BYTES = 8 * 1024;
        const chunks: Buffer[] = [];
        let bodyBytes = 0;
        for await (const c of req) {
          const chunk = c as Buffer;
          bodyBytes += chunk.length;
          if (bodyBytes > MAX_BODY_BYTES) return sendJson(413, { error: 'Body too large.' });
          chunks.push(chunk);
        }
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return sendJson(400, { error: 'Invalid JSON.' }); }
        if (typeof body !== 'object' || body === null) return sendJson(400, { error: 'Invalid request.' });
        const b = body as { url?: unknown };
        if (typeof b.url !== 'string') return sendJson(400, { error: 'Invalid request.' });
        const parsed = parseGithubUrl(b.url);
        if (parsed === null) return sendJson(400, { error: 'Not a supported GitHub URL.' });
        if ('done' in parsed) return sendJson(200, parsed.done);
        try {
          const resp = await fetchGithubPage(parsed.fetchMarketplace);
          if (!resp.ok) return sendJson(502, { error: 'Could not fetch the marketplace page.' });
          const html = await resp.text();
          const { ref, name, repo } = extractFromMarketplaceHtml(html);
          if (ref) return sendJson(200, { kind: 'action', ref, name });
          // No install snippet on the page (some marketplace listings ship none) — fall back
          // to the action's source repo + its default branch, e.g. `owner/repo@main`.
          if (repo && GITHUB_REPO_RE.test(repo)) {
            try {
              const repoResp = await fetchGithubPage(`https://github.com/${repo}`);
              if (repoResp.ok) {
                const branch = extractDefaultBranch(await repoResp.text());
                if (branch) return sendJson(200, { kind: 'action', ref: `${repo}@${branch}`, name });
              }
            } catch {
              // fall through to the 422 below
            }
          }
          return sendJson(422, { error: 'Could not resolve a uses: ref from that page.' });
        } catch {
          return sendJson(502, { error: 'Could not fetch the marketplace page.' });
        }
      }
      const sseMatch = path.match(/^\/api\/runs\/([a-z0-9-]+)\/events$/);
      if (req.method === 'GET' && sseMatch) {
        if (!manager.get(sseMatch[1])) return sendJson(404, { error: 'No such run.' });
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const heartbeat = setInterval(() => res.write(': hb\n\n'), 15000);
        // Pre-declared (not `const`) so the callback can safely reference `unsub` even if it
        // fires before `manager.subscribe(...)` finishes assigning its return value — see
        // runManager's subscribe() for why that can't happen anymore, but this stays as
        // defense in depth. `ended` guards against running the end-of-stream sequence twice
        // (terminal event racing the client disconnecting).
        let unsub: () => void = () => {};
        let ended = false;
        const end = () => {
          if (ended) return;
          ended = true;
          clearInterval(heartbeat);
          unsub();
        };
        // Register BEFORE subscribe so a synchronous throw there still clears the heartbeat
        // (outer catch → res.destroy() → req 'close' → end()).
        req.on('close', end);
        unsub = manager.subscribe(sseMatch[1], (e) => {
          res.write(`data: ${JSON.stringify(e)}\n\n`);
          if (e.kind === 'phase' && e.status !== 'running') {
            res.write('event: end\ndata: {}\n\n');
            end();
            res.end();
          }
        });
        return;
      }
      const cancelMatch = path.match(/^\/api\/runs\/([a-z0-9-]+)\/cancel$/);
      if (req.method === 'POST' && cancelMatch) {
        if (!manager.get(cancelMatch[1])) return sendJson(404, { error: 'No such run.' });
        await manager.cancel(cancelMatch[1]);
        return sendJson(200, { ok: true });
      }
      if (req.method === 'GET' && path === '/api/fs/tree') {
        try {
          const root = await resolveRoot(query.get('root') ?? '');
          const { entries, truncated } = await listTree(root);
          return sendJson(200, { root, entries, truncated });
        } catch (e) { return sendFsError(e); }
      }
      if (req.method === 'GET' && path === '/api/fs/file') {
        try {
          const root = await resolveRoot(query.get('root') ?? '');
          return sendJson(200, await readFileSafe(root, query.get('path') ?? ''));
        } catch (e) { return sendFsError(e); }
      }
      if (req.method === 'PUT' && path === '/api/fs/file') {
        const MAX_BODY_BYTES = 2 * 1024 * 1024;
        const chunks: Buffer[] = [];
        let bodyBytes = 0;
        for await (const c of req) {
          const chunk = c as Buffer;
          bodyBytes += chunk.length;
          if (bodyBytes > MAX_BODY_BYTES) return sendJson(413, { error: 'Body too large.' });
          chunks.push(chunk);
        }
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return sendJson(400, { error: 'Invalid JSON.' }); }
        const b = body as { root?: unknown; path?: unknown; content?: unknown };
        if (typeof b.root !== 'string' || typeof b.path !== 'string' || typeof b.content !== 'string') {
          return sendJson(400, { error: 'PUT requires { root, path, content } strings.' });
        }
        try {
          const root = await resolveRoot(b.root);
          return sendJson(200, await writeFileSafe(root, b.path, b.content));
        } catch (e) { return sendFsError(e); }
      }
      if (req.method === 'GET' && path === '/api/fs/events') {
        let root: string;
        try {
          root = await resolveRoot(query.get('root') ?? ''); // BEFORE writeHead → clean JSON 400/404
        } catch (e) { return sendFsError(e); }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const heartbeat = setInterval(() => res.write(': hb\n\n'), 15000);
        // Pre-declared so onError can reference cleanup/watcher even if it fired synchronously.
        let done = false;
        let watcher: { close(): void } = { close() {} };
        const cleanup = () => {
          if (done) return;
          done = true;
          clearInterval(heartbeat);
          watcher.close(); // idempotent — closed on BOTH disconnect and error
        };
        // Register BEFORE createWatcher: if it throws synchronously, the outer catch does
        // res.destroy() (headers already sent), which fires req 'close' → cleanup clears the
        // heartbeat interval. Without this the interval would leak on that path.
        req.on('close', cleanup);
        watcher = createWatcher(
          root,
          (paths) => res.write(`data: ${JSON.stringify({ kind: 'fs', paths })}\n\n`),
          (message) => {
            res.write(`data: ${JSON.stringify({ kind: 'fs-error', message })}\n\n`);
            res.write('event: end\ndata: {}\n\n');
            cleanup();
            res.end();
          },
          deps.watchFn,
        );
        return;
      }
      if (req.method === 'POST' && path === '/api/setup/action') {
        const MAX_BODY_BYTES = 4 * 1024;
        const chunks: Buffer[] = [];
        let bodyBytes = 0;
        for await (const c of req) {
          const chunk = c as Buffer;
          bodyBytes += chunk.length;
          if (bodyBytes > MAX_BODY_BYTES) return sendJson(413, { error: 'Body too large.' });
          chunks.push(chunk);
        }
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return sendJson(400, { error: 'Invalid JSON.' }); }
        if (typeof body !== 'object' || body === null) return sendJson(400, { error: 'Invalid request.' });
        const b = body as { id?: unknown; engine?: unknown };
        if (typeof b.id !== 'string') return sendJson(400, { error: 'Invalid request.' });
        const primary = resolveSetupAction(b.id, typeof b.engine === 'string' ? b.engine : undefined);
        if (!primary) return sendJson(400, { error: 'Unknown or unsafe action.' });
        const fallback = SETUP_ACTION_FALLBACK[b.id] ?? [];

        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
        let closed = false;
        let child: ReturnType<typeof spawn> | undefined;
        const t = setTimeout(() => { child?.kill(); }, 10 * 60 * 1000);
        req.on('close', () => { closed = true; child?.kill(); });

        // Spawns one fixed command, streams its stdout/stderr to the response, and resolves
        // with its exit code (never rejects — a spawn error resolves 127, mirroring a failed run).
        const spawnStream = (cmd: string, args: string[]): Promise<number> => new Promise((resolve) => {
          try {
            const c = spawn(cmd, args, { windowsHide: true });
            child = c;
            c.stdout?.on('data', (d) => { if (!closed) res.write(d); });
            c.stderr?.on('data', (d) => { if (!closed) res.write(d); });
            c.on('error', (err) => {
              if (!closed) res.write(`\n[error] ${err.message}\n`);
              resolve(127);
            });
            c.on('close', (code) => resolve(code ?? 1));
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to start command.';
            if (!closed) res.write(`\n[error] ${message}\n`);
            resolve(127);
          }
        });

        void (async () => {
          let code = await spawnStream(primary.cmd, primary.args);
          if (code !== 0 && !closed && fallback.length) {
            res.write('\n[retrying with setup…]\n');
            for (const step of fallback as SafeCommand[]) {
              if (closed) break;
              code = await spawnStream(step.cmd, step.args);
            }
          }
          clearTimeout(t);
          if (!closed) {
            res.write(`\n[[EXIT:${code}]]\n`);
            res.end();
          }
        })();
        return;
      }
      sendJson(404, { error: 'Not found.' });
    } catch (err) {
      // Headers may already be written (e.g. an SSE stream mid-flight) — calling sendJson()
      // here would try to write a second set of headers and throw ERR_HTTP_HEADERS_SENT as
      // an unhandled rejection, crashing the process. Just tear down the connection instead.
      if (res.headersSent) { res.destroy(); return; }
      sendJson(500, { error: err instanceof Error ? err.message : 'Internal error.' });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : port;
  return {
    port: boundPort,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

if (process.env.RUNNER_AUTOSTART !== '0' && process.argv[1] && /index\.(ts|js|mjs)$/.test(process.argv[1])) {
  startServer().then(
    ({ port }) => console.log(`gha-designer runner listening on http://127.0.0.1:${port}`),
    (err) => {
      console.error(`Failed to start runner server: ${err instanceof Error ? err.message : err}`);
      console.error('Is another instance running on port 7791?');
      process.exit(1);
    },
  );
}
