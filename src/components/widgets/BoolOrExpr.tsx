import type { ReactNode } from 'react';

export default function BoolOrExpr({ label, value, onChange }: {
  label: string;
  value: boolean | string | undefined;
  onChange(next: boolean | string | undefined): void;
}): ReactNode {
  const mode = value === undefined ? '' : typeof value === 'boolean' ? String(value) : 'expr';
  return (
    <label>{label}
      <select value={mode} onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? undefined : v === 'expr' ? '${{ }}' : v === 'true');
      }}>
        <option value="">unset</option>
        <option value="true">true</option>
        <option value="false">false</option>
        <option value="expr">expression…</option>
      </select>
      {mode === 'expr' && (
        <input value={value as string} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
