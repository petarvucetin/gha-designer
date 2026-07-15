import { useEffect, useState } from 'react';

function KVRow({ k, v, onCommit, onRemove }: {
  k: string;
  v: string;
  onCommit(k: string, v: string): void;
  onRemove(): void;
}) {
  const [keyDraft, setKeyDraft] = useState(k);
  const [valueDraft, setValueDraft] = useState(v);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) {
      setKeyDraft(k);
      setValueDraft(v);
    }
  }, [k, v, focused]);
  const commit = () => onCommit(keyDraft, valueDraft);
  return (
    <div className="kv-row">
      <input
        value={keyDraft}
        placeholder="key"
        onChange={(e) => setKeyDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      />
      <input
        value={valueDraft}
        placeholder="value"
        onChange={(e) => setValueDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      />
      <button type="button" className="mini" onClick={onRemove}>✕</button>
    </div>
  );
}

export default function KVEditor({ value, onChange }: {
  value: Record<string, string> | undefined;
  onChange(next: Record<string, string>): void;
}) {
  const entries = Object.entries(value ?? {});
  const setEntry = (i: number, k: string, v: string) => {
    const next = [...entries];
    next[i] = [k, v];
    onChange(Object.fromEntries(next));
  };
  return (
    <div className="kv-editor">
      {entries.map(([k, v], i) => (
        <KVRow
          key={i}
          k={k}
          v={v}
          onCommit={(nk, nv) => setEntry(i, nk, nv)}
          onRemove={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))}
        />
      ))}
      <button type="button" className="mini add" onClick={() => onChange({ ...(value ?? {}), '': '' })}>+ add</button>
    </div>
  );
}
