import { isTauri } from './apiBase';

/**
 * Open an external URL in the user's real browser. Under the packaged Tauri app this uses the
 * opener plugin (a bare <a target=_blank> would try to navigate the app's own webview); in the
 * dev/browser build it falls back to window.open.
 */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
