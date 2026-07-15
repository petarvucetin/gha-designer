import type { Container } from '../../model/types';
import KVEditor from '../KVEditor';
import ListInput from './ListInput';

export default function ContainerEditor({ value, onChange }: {
  value: Container | undefined;
  onChange(next: Container | undefined): void;
}) {
  const c = value ?? { image: '' };
  const set = (patch: Partial<Container>) => onChange({ ...c, ...patch });
  return (
    <div className="container-editor">
      <label>image
        <input value={c.image} placeholder="node:20"
          onChange={(e) => set({ image: e.target.value })} />
      </label>
      <label>credentials username
        <input value={c.credentials?.username ?? ''}
          onChange={(e) => {
            const credentials = { ...c.credentials, username: e.target.value || undefined };
            set({ credentials: credentials.username === undefined && credentials.password === undefined ? undefined : credentials });
          }} />
      </label>
      <label>credentials password
        <input value={c.credentials?.password ?? ''} placeholder="${{ secrets.REGISTRY_TOKEN }}"
          onChange={(e) => {
            const credentials = { ...c.credentials, password: e.target.value || undefined };
            set({ credentials: credentials.username === undefined && credentials.password === undefined ? undefined : credentials });
          }} />
      </label>
      <details>
        <summary>env ({Object.keys(c.env ?? {}).length})</summary>
        <KVEditor value={c.env} onChange={(env) => set({ env: Object.keys(env).length ? env : undefined })} />
      </details>
      <label>ports<ListInput value={c.ports} placeholder="5432:5432" onChange={(ports) => set({ ports })} /></label>
      <label>volumes<ListInput value={c.volumes} placeholder="/src:/dst" onChange={(volumes) => set({ volumes })} /></label>
      <label>options
        <input value={c.options ?? ''} onChange={(e) => set({ options: e.target.value || undefined })} />
      </label>
      <button type="button" className="mini" onClick={() => onChange(undefined)}>remove container</button>
    </div>
  );
}
