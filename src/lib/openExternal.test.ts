import { afterEach, describe, expect, it, vi } from 'vitest';
import { openExternal } from './openExternal';

const openUrlMock = vi.fn();
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: (...args: unknown[]) => openUrlMock(...args),
}));

// This suite runs under vitest's default `node` environment (no jsdom/happy-dom in
// this repo — see src/lib/apiBase.test.ts for the same pattern), so `window` isn't a
// real global here. Stub it per-test with vi.stubGlobal rather than relying on a
// browser-provided `window`.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('openExternal', () => {
  it('uses window.open in the browser (no Tauri globals)', async () => {
    const openSpy = vi.fn();
    vi.stubGlobal('window', { open: openSpy });
    await openExternal('https://podman.io/');
    expect(openSpy).toHaveBeenCalledWith('https://podman.io/', '_blank', 'noopener,noreferrer');
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it('uses the Tauri opener when the Tauri global is present', async () => {
    const openSpy = vi.fn();
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, open: openSpy });
    await openExternal('https://podman.io/');
    expect(openUrlMock).toHaveBeenCalledWith('https://podman.io/');
    expect(openSpy).not.toHaveBeenCalled();
  });
});
