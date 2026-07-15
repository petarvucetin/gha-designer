// In a packaged Tauri app there is no Vite dev proxy, so /api calls must go
// straight to the sidecar runner. In the browser/dev, keep them relative so
// Vite's proxy (vite.config.ts) forwards /api -> 127.0.0.1:7791.

/** True when running inside the packaged Tauri webview. */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

const inTauri = isTauri();

export const API_BASE = inTauri ? 'http://127.0.0.1:7791' : '';

/** Prefix an /api path with the runner base (absolute under Tauri, relative in the browser). */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
