import { create } from 'zustand';
import { freshId } from './model/types';

export interface SavedRef { id: string; name: string; ref: string; kind: 'action' | 'workflow'; }

interface SavedState {
  saved: SavedRef[];
  addSaved(item: { name: string; ref: string; kind: 'action' | 'workflow' }): void;
  removeSaved(id: string): void;
}

const KEY = 'gha-saved-refs-v1';
function load(): SavedRef[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.ref === 'string' && (x.kind === 'action' || x.kind === 'workflow'))
      : [];
  } catch { return []; }
}

export const useSaved = create<SavedState>((set, get) => ({
  saved: load(),
  addSaved: (item) => {
    // dedup by ref (case-insensitive); if present, move to front (keep existing id)
    const existing = get().saved.find((s) => s.ref.toLowerCase() === item.ref.toLowerCase());
    const entry: SavedRef = existing
      ? { ...existing, name: item.name || existing.name }
      : { id: freshId('saved'), name: item.name || item.ref, ref: item.ref, kind: item.kind };
    set((s) => ({ saved: [entry, ...s.saved.filter((x) => x.id !== entry.id)] }));
  },
  removeSaved: (id) => set((s) => ({ saved: s.saved.filter((x) => x.id !== id) })),
}));

// persist on every change (cheap; small list)
useSaved.subscribe((s) => {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(s.saved)); } catch { /* quota/private mode */ }
});
