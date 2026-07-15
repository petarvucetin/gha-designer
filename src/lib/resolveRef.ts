import { apiUrl } from './apiBase';

export type ResolvedRef = { kind: 'action' | 'workflow'; ref: string; name?: string };

export async function resolveDroppedUrl(url: string): Promise<ResolvedRef | null> {
  try {
    const res = await fetch(apiUrl('/api/resolve-ref'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && typeof data.ref === 'string' && (data.kind === 'action' || data.kind === 'workflow')) return data;
    return null;
  } catch { return null; }
}
