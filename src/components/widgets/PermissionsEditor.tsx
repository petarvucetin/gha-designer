import { PERMISSION_SCOPES } from '../../model/catalog';
import type { Permissions } from '../../model/types';

type Preset = 'default' | 'read-all' | 'write-all' | 'custom';

function presetOf(p: Permissions | undefined): Preset {
  if (p === undefined) return 'default';
  if (p === 'read-all' || p === 'write-all') return p;
  return 'custom';
}

export default function PermissionsEditor({ value, onChange }: {
  value: Permissions | undefined;
  onChange(next: Permissions | undefined): void;
}) {
  const preset = presetOf(value);
  const map: Record<string, 'read' | 'write' | 'none'> =
    typeof value === 'object' && value !== null ? value : {};
  const setScope = (scope: string, v: string) => {
    const next = { ...map };
    if (v === '') delete next[scope];
    else next[scope] = v as 'read' | 'write' | 'none';
    onChange(next);
  };
  return (
    <div className="permissions-editor">
      <select
        value={preset}
        onChange={(e) => {
          const p = e.target.value as Preset;
          onChange(p === 'default' ? undefined : p === 'custom' ? {} : p);
        }}
      >
        <option value="default">default (unset)</option>
        <option value="read-all">read-all</option>
        <option value="write-all">write-all</option>
        <option value="custom">custom…</option>
      </select>
      {preset === 'custom' && (
        <div className="perm-grid">
          {PERMISSION_SCOPES.map((s) => (
            <label key={s.name} className="perm-row">
              <span>{s.name}</span>
              <select value={map[s.name] ?? ''} onChange={(e) => setScope(s.name, e.target.value)}>
                <option value="">unset</option>
                {s.values.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
