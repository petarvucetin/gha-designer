export default function CheckboxGrid({ options, value, onChange }: {
  options: string[];
  value: string[] | undefined;
  onChange(next: string[] | undefined): void;
}) {
  const selected = new Set(value ?? []);
  const toggle = (opt: string) => {
    const next = new Set(selected);
    if (next.has(opt)) next.delete(opt); else next.add(opt);
    onChange(next.size ? options.filter((o) => next.has(o)) : undefined);
  };
  return (
    <div className="checkbox-grid">
      {options.map((o) => (
        <label key={o} className="checkbox-item">
          <input type="checkbox" checked={selected.has(o)} onChange={() => toggle(o)} /> {o}
        </label>
      ))}
    </div>
  );
}
