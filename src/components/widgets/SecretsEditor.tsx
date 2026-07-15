import { useEffect, useState } from 'react';

function SecretRow({ k, v, onCommit, onRemove }: {
  k: string; v: string;
  onCommit(key: string, value: string): void;
  onRemove(): void;
}) {
  const [keyDraft, setKeyDraft] = useState(k);
  const [valDraft, setValDraft] = useState(v);
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) { setKeyDraft(k); setValDraft(v); }
  }, [k, v, focused]);
  const commit = () => onCommit(keyDraft, valDraft);
  return (
    <div className="kv-row">
      <input value={keyDraft} placeholder="SECRET_NAME"
        onFocus={() => setFocused(true)}
        onChange={(e) => setKeyDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      <input value={valDraft} placeholder="value" type={show ? 'text' : 'password'}
        onFocus={() => setFocused(true)}
        onChange={(e) => setValDraft(e.target.value)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      <button type="button" className="mini" onClick={() => setShow((s) => !s)} title="reveal">
        {show ? '🙈' : '👁'}
      </button>
      <button type="button" className="mini" onClick={onRemove}>✕</button>
    </div>
  );
}

export default function SecretsEditor({ value, onChange }: {
  value: Record<string, string>;
  onChange(next: Record<string, string>): void;
}) {
  const entries = Object.entries(value);
  return (
    <div className="kv-editor">
      {entries.map(([k, v], i) => (
        <SecretRow key={i} k={k} v={v}
          onCommit={(nk, nv) => {
            const next = entries.map((e, j) => (j === i ? [nk, nv] as const : e));
            onChange(Object.fromEntries(next));
          }}
          onRemove={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))} />
      ))}
      <button type="button" className="mini add" onClick={() => onChange({ ...value, '': '' })}>+ add secret</button>
    </div>
  );
}
