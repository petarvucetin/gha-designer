import { create } from 'zustand';
import type { WorkflowDoc } from './model/types';
import { toYaml } from './model/toYaml';
import { fromYaml } from './model/fromYaml';
import { updateYaml } from './model/updateYaml';
import { useEditor } from './store';
import { API_BASE } from './lib/apiBase';

export type FsEntry = { path: string; type: 'file' | 'dir'; size: number };
export type FileResult = { path: string; size: number; mtimeMs: number; binary: boolean; content?: string; encoding?: 'base64' };
export type Viewer = { path: string; kind: 'text' | 'image' | 'binary'; content?: string; mime?: string; size: number; note?: string };

type Folder = {
  input: string; root: string; entries: FsEntry[]; truncated: boolean;
  status: 'open' | 'error'; error?: string;
};

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', svg: 'image/svg+xml',
};
const FOLDER_KEY = 'gha-designer:folder';
const api = (p: string) => `${API_BASE}/api${p}`;

export function pickViewerKind(path: string, res: FileResult, note?: string): Viewer {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (mime) {
    const b64 = res.encoding === 'base64'
      ? res.content ?? ''
      : btoa(unescape(encodeURIComponent(res.content ?? ''))); // svg text → base64 data uri
    return { path, kind: 'image', content: b64, mime, size: res.size, note };
  }
  if (res.binary) return { path, kind: 'binary', size: res.size, note: note ?? `Binary file (${res.size} bytes) — no preview.` };
  return { path, kind: 'text', content: res.content, size: res.size, note };
}

export function shouldReconcile(doc: WorkflowDoc, root: string): boolean {
  return doc.source?.root === root;
}

let es: EventSource | null = null;
let chain: Promise<void> = Promise.resolve();
const enqueue = (fn: () => Promise<void>): Promise<void> => {
  const next = chain.then(fn).catch(() => {});
  chain = next;
  return next;
};
// Bumped on every openFolder/closeFolder call; an in-flight openFolder bails as soon as it
// notices its captured generation is stale, so only the most-recently-invoked call ever wins.
let openGen = 0;
// docIds with a save already queued or in-flight — collapses redundant rapid saves and keeps
// bindSaved calls in call order (see saveActive).
const savingDocs = new Set<string>();

async function getFile(root: string, path: string): Promise<FileResult | null> {
  const res = await fetch(api(`/fs/file?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as FileResult;
}

type FsState = {
  folder: Folder | null;
  viewer: Viewer | null;
  saveError?: string;
  openFolder(input: string): Promise<void>;
  closeFolder(): void;
  openEntry(path: string): Promise<void>;
  closeViewer(): void;
  saveActive(): Promise<void>;
  onFsBatch(paths: string[]): void;
  onFsError(message: string): void;
  boot(): void;
};

export const useFs = create<FsState>((set, get) => ({
  folder: null,
  viewer: null,
  saveError: undefined,

  openFolder: async (input) => {
    const gen = ++openGen;
    let data: { root: string; entries: FsEntry[]; truncated: boolean };
    try {
      const res = await fetch(api(`/fs/tree?root=${encodeURIComponent(input)}`));
      if (!res.ok) {
        const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Could not open folder (${res.status}).`;
        if (gen !== openGen) return; // superseded by a later openFolder/closeFolder while awaiting
        set({ folder: { input, root: '', entries: [], truncated: false, status: 'error', error: msg } });
        return;
      }
      data = (await res.json()) as typeof data;
    } catch {
      if (gen !== openGen) return;
      set({ folder: { input, root: '', entries: [], truncated: false, status: 'error', error: 'Runner server is not reachable — start it with: npm run server' } });
      return;
    }
    if (gen !== openGen) return;
    try { globalThis.localStorage?.setItem(FOLDER_KEY, input); } catch { /* quota/private mode: degrade silently */ }
    // Reset viewer here too: a viewer opened against the previous root must not survive into this one.
    set({ folder: { input, root: data.root, entries: data.entries, truncated: data.truncated, status: 'open' }, viewer: null, saveError: undefined });
    // reconcile every doc bound to this root (serialized) — initializes sourceRt from disk.
    // Gate the loop itself on gen so a superseded open doesn't schedule reconciles for a root
    // this call no longer represents; the enqueued closures themselves are left as-is (they
    // re-derive state from useEditor at execution time, so a queued one is still safe to run).
    if (gen === openGen) {
      for (const doc of useEditor.getState().workflows) {
        if (!shouldReconcile(doc, data.root)) continue;
        const { id } = doc;
        const path = doc.source!.path;
        enqueue(async () => {
          const file = await getFile(data.root, path).catch(() => null);
          useEditor.getState().applyDiskChange(id, file ? file.content ?? '' : null, file?.mtimeMs ?? Date.now());
        });
      }
    }
    if (gen !== openGen) return;
    es?.close();
    es = new EventSource(api(`/fs/events?root=${encodeURIComponent(data.root)}`));
    es.onmessage = (m) => {
      const evt = JSON.parse(m.data) as { kind: 'fs'; paths: string[] } | { kind: 'fs-error'; message: string };
      if (evt.kind === 'fs') get().onFsBatch(evt.paths);
      else get().onFsError(evt.message);
    };
    es.onerror = () => get().onFsError('Lost the connection to the folder watcher.');
  },

  closeFolder: () => {
    openGen += 1; // cancel any in-flight openFolder before it can install stale state
    es?.close(); es = null;
    try { globalThis.localStorage?.removeItem(FOLDER_KEY); } catch { /* quota/private mode: degrade silently */ }
    set({ folder: null, viewer: null, saveError: undefined });
  },

  openEntry: async (path) => {
    const folder = get().folder;
    if (!folder || folder.status !== 'open') return;
    const isYaml = /\.ya?ml$/i.test(path);
    let res: Response;
    try { res = await fetch(api(`/fs/file?root=${encodeURIComponent(folder.root)}&path=${encodeURIComponent(path)}`)); }
    catch { set({ viewer: { path, kind: 'binary', size: 0, note: 'Runner server is not reachable.' } }); return; }
    if (res.status === 404) { set({ viewer: { path, kind: 'text', size: 0, note: 'File was deleted.' } }); return; }
    if (!res.ok) {
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Could not open file (${res.status}).`;
      set({ viewer: { path, kind: 'binary', size: 0, note: msg } }); // e.g. > 1 MiB size note
      return;
    }
    const file = (await res.json()) as FileResult;
    if (isYaml && !file.binary) {
      // Only load real workflows onto the canvas. fromYaml is lenient (it won't throw on,
      // say, dependabot.yml or an action.yml), so a throw alone doesn't identify a
      // non-workflow — a parse that yields no nodes does. Either way, show it read-only.
      const text = file.content ?? '';
      let isWorkflow = false;
      try { isWorkflow = fromYaml(text).nodes.length > 0; } catch { isWorkflow = false; }
      if (isWorkflow) {
        try {
          useEditor.getState().openFromFile(folder.root, path, text, file.mtimeMs);
          set({ viewer: null });
          return;
        } catch { /* fall through to the read-only viewer */ }
      }
      set({ viewer: pickViewerKind(path, file, 'Not a workflow — shown read-only.') });
      return;
    }
    set({ viewer: pickViewerKind(path, file) });
  },

  closeViewer: () => set({ viewer: null }),

  saveActive: async () => {
    const editor = useEditor.getState();
    const folder = get().folder;
    const doc = editor.workflows.find((w) => w.id === editor.activeId);
    if (!doc?.source || !doc.sourceRt || !folder || folder.status !== 'open' || folder.root !== doc.source.root) {
      set({ saveError: 'This tab is not linked to the open folder.' });
      return;
    }
    const docId = doc.id;
    if (savingDocs.has(docId)) return; // a save for this doc is already queued or in-flight
    savingDocs.add(docId);
    const { root, path } = doc.source;
    const canonical = toYaml(editor.snapshot());
    // Comment-preserving save: reconcile the edited snapshot onto the last-known disk text
    // so untouched sections keep their comments/formatting. Falls back to canonical when
    // there's no disk text to reconcile onto (updateYaml itself falls back on unparseable text).
    const content = doc.sourceRt.diskText ? updateYaml(doc.sourceRt.diskText, editor.snapshot()) : canonical;
    // Route through the same chain as reconcile/batch application: a second save for a
    // different doc still queues behind this one, and (via the guard above) a second save
    // for the SAME doc can't be queued at all — both needed so bindSaved calls always land
    // in call order and never roll sourceRt.mtimeMs backward.
    await enqueue(async () => {
      try {
        const res = await fetch(api('/fs/file'), {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ root, path, content }),
        });
        if (!res.ok) {
          const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Save failed (${res.status}).`;
          set({ saveError: msg });
          return;
        }
        const { mtimeMs } = (await res.json()) as { mtimeMs: number };
        useEditor.getState().bindSaved(docId, canonical, content, mtimeMs);
        set({ saveError: undefined });
      } catch {
        set({ saveError: 'Runner server is not reachable.' });
      } finally {
        savingDocs.delete(docId);
      }
    });
  },

  onFsBatch: (paths) => {
    const folder = get().folder;
    if (!folder || folder.status !== 'open') return;
    const root = folder.root;
    const changed = new Set(paths);
    // refresh the tree once
    enqueue(async () => {
      const res = await fetch(api(`/fs/tree?root=${encodeURIComponent(root)}`)).catch(() => null);
      if (!res || !res.ok) return;
      const { entries, truncated } = (await res.json()) as { entries: FsEntry[]; truncated: boolean };
      const f = get().folder;
      if (f && f.root === root && f.status === 'open') set({ folder: { ...f, entries, truncated } });
    });
    // refresh the open viewer if its file changed
    const viewer = get().viewer;
    if (viewer && changed.has(viewer.path)) {
      enqueue(async () => {
        const file = await getFile(root, viewer.path).catch(() => undefined);
        const cur = get().viewer;
        if (!cur || cur.path !== viewer.path) return;
        if (file === null) { set({ viewer: { ...cur, note: 'File was deleted.' } }); return; }
        if (file) set({ viewer: pickViewerKind(viewer.path, file) });
      });
    }
    // apply to each live-bound doc whose path changed (serialized; mtime guard lives in applyDiskChange)
    for (const doc of useEditor.getState().workflows) {
      if (!doc.source || !doc.sourceRt || doc.source.root !== root || !changed.has(doc.source.path)) continue;
      const { id } = doc;
      const path = doc.source.path;
      enqueue(async () => {
        const file = await getFile(root, path).catch(() => null);
        useEditor.getState().applyDiskChange(id, file ? file.content ?? '' : null, file?.mtimeMs ?? Date.now());
      });
    }
  },

  onFsError: (message) => {
    es?.close(); es = null;
    set((s) => (s.folder ? { folder: { ...s.folder, status: 'error', error: message } } : {}));
  },

  boot: () => {
    let input: string | null = null;
    try { input = globalThis.localStorage?.getItem(FOLDER_KEY) ?? null; } catch { /* quota/private mode: degrade silently */ }
    if (input) void get().openFolder(input);
  },
}));
