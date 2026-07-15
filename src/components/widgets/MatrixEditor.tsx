import { useEffect, useState } from 'react';
import { coerceScalar, uniqueName } from '../../model/mapping';
import type { MatrixStrategy } from '../../model/types';

function ValuesInput({ values, onChange }: {
  values: unknown[];
  onChange(next: unknown[]): void;
}) {
  const [draft, setDraft] = useState(values.map(String).join(', '));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(values.map(String).join(', '));
  }, [values, focused]);
  const commit = () =>
    onChange(draft.split(',').map((s) => s.trim()).filter(Boolean).map(coerceScalar));
  return (
    <input value={draft} placeholder="18, 20, 22"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
  );
}

function JsonListInput({ label, value, onChange }: {
  label: string;
  value: Record<string, unknown>[] | undefined;
  onChange(next: Record<string, unknown>[] | undefined): void;
}) {
  const [draft, setDraft] = useState(value ? JSON.stringify(value, null, 1) : '');
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused && !error) {
      setDraft(value ? JSON.stringify(value, null, 1) : '');
    }
  }, [value, focused, error]);
  const commit = () => {
    if (!draft.trim()) { setError(null); onChange(undefined); return; }
    try {
      const parsed = JSON.parse(draft);
      if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'object' && x !== null && !Array.isArray(x))) {
        setError('must be a JSON array of objects'); return;
      }
      setError(null);
      onChange(parsed as Record<string, unknown>[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <label>{label} (JSON array of objects)
      <textarea rows={3} value={draft} placeholder='[{"node": 22, "experimental": true}]'
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }} />
      {error && <div className="inline-error">{error}</div>}
    </label>
  );
}

export default function MatrixEditor({ value, onChange }: {
  value: MatrixStrategy | undefined;
  onChange(next: MatrixStrategy | undefined): void;
}) {
  const s = value ?? {};
  const vars = Object.entries(s.matrix?.vars ?? {});
  const emit = (next: MatrixStrategy) => {
    const empty = !next.matrix && next.failFast === undefined && next.maxParallel == null;
    onChange(empty ? undefined : next);
  };
  const setVars = (nextVars: [string, unknown[]][]) => {
    const matrix = nextVars.length || s.matrix?.include?.length || s.matrix?.exclude?.length
      ? { ...s.matrix, vars: Object.fromEntries(nextVars) }
      : undefined;
    emit({ ...s, matrix });
  };
  const setMatrixPart = (p: Partial<NonNullable<MatrixStrategy['matrix']>>) => {
    const merged = { vars: {}, ...s.matrix, ...p };
    const matrix = Object.keys(merged.vars).length || merged.include?.length || merged.exclude?.length
      ? merged
      : undefined;
    emit({ ...s, matrix });
  };
  return (
    <div className="matrix-editor">
      {vars.map(([name, values], i) => (
        <div className="kv-row" key={i}>
          <input value={name} placeholder="variable"
            onChange={(e) => setVars(vars.map((v, j) => (j === i ? [e.target.value, v[1]] : v)))} />
          <ValuesInput values={values}
            onChange={(next) => setVars(vars.map((v, j) => (j === i ? [v[0], next] : v)))} />
          <button type="button" className="mini" onClick={() => setVars(vars.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="mini add"
        onClick={() => setVars([...vars, [uniqueName('var', vars.map(([n]) => n)), []]])}>+ add variable</button>
      <JsonListInput label="include" value={s.matrix?.include} onChange={(include) => setMatrixPart({ include })} />
      <JsonListInput label="exclude" value={s.matrix?.exclude} onChange={(exclude) => setMatrixPart({ exclude })} />
      <label>fail-fast
        <select value={s.failFast === undefined ? '' : String(s.failFast)}
          onChange={(e) => emit({ ...s, failFast: e.target.value === '' ? undefined : e.target.value === 'true' })}>
          <option value="">unset</option><option value="true">true</option><option value="false">false</option>
        </select>
      </label>
      <label>max-parallel
        <input type="number" min={1} value={s.maxParallel ?? ''}
          onChange={(e) => emit({ ...s, maxParallel: e.target.value ? Number(e.target.value) : undefined })} />
      </label>
    </div>
  );
}
