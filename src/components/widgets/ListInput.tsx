import { useEffect, useState } from 'react';

export default function ListInput({ value, onChange, placeholder }: {
  value: string[] | undefined;
  onChange(next: string[] | undefined): void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState((value ?? []).join(', '));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft((value ?? []).join(', '));
  }, [value, focused]);
  const commit = () => {
    const items = draft.split(',').map((s) => s.trim()).filter(Boolean);
    onChange(items.length ? items : undefined);
  };
  return (
    <input
      value={draft}
      placeholder={placeholder ?? 'a, b, c'}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
    />
  );
}
