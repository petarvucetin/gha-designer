import { describe, expect, it, vi } from 'vitest';
import { pickViewerKind, shouldReconcile, useFs, type FileResult } from './fsStore';
import { useEditor } from './store';
import { hashText } from './model/hash';
import type { WorkflowDoc } from './model/types';

const res = (over: Partial<FileResult>): FileResult => ({ path: 'x', size: 3, mtimeMs: 1, binary: false, ...over });

describe('pickViewerKind', () => {
  it('text file → text', () => {
    expect(pickViewerKind('README.md', res({ content: '# hi' })).kind).toBe('text');
  });
  it('png (base64) and svg (text) both → image data', () => {
    const png = pickViewerKind('logo.png', res({ path: 'logo.png', binary: true, encoding: 'base64', content: 'AAAB' }));
    expect(png).toMatchObject({ kind: 'image', mime: 'image/png', content: 'AAAB' });
    const svg = pickViewerKind('icon.svg', res({ path: 'icon.svg', content: '<svg/>' }));
    expect(svg.kind).toBe('image');
    expect(svg.mime).toBe('image/svg+xml');
    expect(Buffer.from(svg.content!, 'base64').toString()).toBe('<svg/>');
  });
  it('non-image binary → size note', () => {
    const v = pickViewerKind('data.bin', res({ path: 'data.bin', binary: true, size: 42 }));
    expect(v.kind).toBe('binary');
    expect(v.note).toContain('42');
  });
});

describe('shouldReconcile', () => {
  const doc = (root?: string): WorkflowDoc => ({
    id: 'i', fileName: 'ci.yml', meta: { name: 'x' }, nodes: [], edges: [],
    ...(root ? { source: { root, path: 'workflows/ci.yml', diskHash: 'h' } } : {}),
  });
  it('true only when the doc source root matches', () => {
    expect(shouldReconcile(doc('R'), 'R')).toBe(true);
    expect(shouldReconcile(doc('R'), 'OTHER')).toBe(false);
    expect(shouldReconcile(doc(), 'R')).toBe(false);
  });
});

// Fake fetch that resolves /fs/tree?root=<root> only when the matching entry in the
// returned map is invoked — lets a test control exactly which openFolder call's tree
// request settles first, independent of call order.
type FakeRes = { ok: boolean; status?: number; json: () => Promise<unknown> };
function stubTreeFetch(): Record<string, () => void> {
  const waiters: Record<string, () => void> = {};
  vi.stubGlobal('fetch', vi.fn((url: string) => new Promise<FakeRes>((resolve) => {
    const root = new URL(url, 'http://x').searchParams.get('root') ?? '';
    waiters[root] = () => resolve({ ok: true, json: async () => ({ root, entries: [], truncated: false }) });
  })));
  return waiters;
}
function stubEventSource() {
  vi.stubGlobal('EventSource', class {
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: string) {}
    close() {}
  });
}

describe('saveActive (comment-preserving save)', () => {
  const ORIG = `# CI pipeline for the widget service
name: CI
on:
  push:
    branches: [main] # trunk only
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      # pinned for provenance (see SEC-142)
      - uses: actions/checkout@v4
      - run: npm test
`;

  it('PUTs updateYaml-reconciled content (preserving comments) and rebinds diskHash to what was written', async () => {
    useEditor.getState().openFromFile('R', 'workflows/ci.yml', ORIG, 100);
    const docId = useEditor.getState().activeId;
    useFs.setState({ folder: { input: 'R', root: 'R', entries: [], truncated: false, status: 'open' } });
    useEditor.getState().updateMeta({ name: 'CI2' });

    let putBody: { root: string; path: string; content: string } | null = null;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'PUT') {
        putBody = JSON.parse(init.body ?? '{}');
        return Promise.resolve({ ok: true, json: async () => ({ mtimeMs: 999 }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    await useFs.getState().saveActive();

    expect(putBody).not.toBeNull();
    expect(putBody!.content).toContain('# pinned for provenance (see SEC-142)');
    expect(putBody!.content).toContain('name: CI2');

    const doc = useEditor.getState().workflows.find((w) => w.id === docId)!;
    expect(doc.source!.diskHash).toBe(hashText(putBody!.content));

    vi.unstubAllGlobals();
  });
});

describe('openFolder concurrency', () => {
  it('a later openFolder call wins even when the earlier call resolves last (out of order)', async () => {
    vi.resetModules();
    const waiters = stubTreeFetch();
    stubEventSource();
    const { useFs: fresh } = await import('./fsStore');

    const pA = fresh.getState().openFolder('A'); // gen 1
    const pB = fresh.getState().openFolder('B'); // gen 2, called after A

    waiters.B(); // the LATER call's request settles first
    await pB;
    expect(fresh.getState().folder?.root).toBe('B');

    waiters.A(); // the EARLIER call's request settles last (out of order)
    await pA;
    expect(fresh.getState().folder?.root).toBe('B'); // must not be clobbered by the stale call

    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('closeFolder cancels an in-flight openFolder (stale result is discarded)', async () => {
    vi.resetModules();
    const waiters = stubTreeFetch();
    stubEventSource();
    const { useFs: fresh } = await import('./fsStore');

    const p = fresh.getState().openFolder('A');
    fresh.getState().closeFolder(); // bumps the generation while A is still in flight

    waiters.A(); // A's request finally settles, after being cancelled
    await p;
    expect(fresh.getState().folder).toBeNull();

    vi.unstubAllGlobals();
    vi.resetModules();
  });
});
