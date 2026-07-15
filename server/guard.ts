const HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
// Origin allowlist: the same loopback hosts, plus the packaged Tauri webview's origin
// (WebView2 on Windows serves the app from http://tauri.localhost). The Host header check
// above is unaffected — the server itself is still only ever bound to a loopback address.
const ORIGIN_HOSTS = new Set([...HOSTS, 'tauri.localhost']);

export function checkRequest(req: {
  method: string;
  headers: Record<string, string | string[] | undefined>;
}): { ok: true } | { ok: false; code: number; message: string } {
  const hostHeader = String(req.headers.host ?? '');
  let hostname = '';
  try {
    hostname = new URL(`http://${hostHeader}`).hostname;
  } catch {
    return { ok: false, code: 403, message: 'Bad Host header.' };
  }
  if (!HOSTS.has(hostname)) return { ok: false, code: 403, message: 'Host not allowed.' };
  const origin = req.headers.origin;
  if (origin !== undefined) {
    const o = String(origin);
    if (o === 'null') return { ok: false, code: 403, message: 'Null origin not allowed.' };
    try {
      if (!ORIGIN_HOSTS.has(new URL(o).hostname)) return { ok: false, code: 403, message: 'Origin not allowed.' };
    } catch {
      return { ok: false, code: 403, message: 'Bad Origin header.' };
    }
  }
  if (req.method === 'POST' || req.method === 'PUT') {
    const ct = String(req.headers['content-type'] ?? '');
    if (!ct.startsWith('application/json')) return { ok: false, code: 415, message: 'POST/PUT requires application/json.' };
  }
  return { ok: true };
}
