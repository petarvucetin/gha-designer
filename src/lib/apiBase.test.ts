import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('apiUrl', () => {
  it('browser/dev (no Tauri global): paths stay relative so Vite proxies /api', async () => {
    const { apiUrl, API_BASE } = await import('./apiBase');
    expect(API_BASE).toBe('');
    expect(apiUrl('/api/x')).toBe('/api/x');
  });

  it('packaged Tauri (window.__TAURI_INTERNALS__ present): paths target the sidecar absolutely', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    const { apiUrl, API_BASE } = await import('./apiBase');
    expect(API_BASE).toBe('http://127.0.0.1:7791');
    expect(apiUrl('/api/x')).toBe('http://127.0.0.1:7791/api/x');
  });
});
