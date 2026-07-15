import { apiUrl } from './apiBase';

/** Run a whitelisted setup action; streams output to onText (running, sentinel-stripped). Returns the exit code. */
export async function runSetupAction(
  body: { id: string; engine?: string },
  onText: (text: string) => void,
): Promise<{ code: number }> {
  let res: Response;
  try {
    res = await fetch(apiUrl('/api/setup/action'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    onText('Could not reach the runner server.');
    return { code: 1 };
  }
  const reader = res.body?.getReader();
  if (!res.ok || !reader) {
    onText((await res.text().catch(() => '')) || `Action failed (${res.status}).`);
    return { code: 1 };
  }
  const dec = new TextDecoder();
  let raw = '';
  const strip = (s: string) => s.replace(/\n?\[\[EXIT:-?\d+\]\]\n?/, '');
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    raw += dec.decode(value, { stream: true });
    onText(strip(raw));
  }
  const m = raw.match(/\[\[EXIT:(-?\d+)\]\]/);
  return { code: m ? Number(m[1]) : 1 };
}
