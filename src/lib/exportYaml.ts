import { FILE_NAME_RE } from '../model/localUses';

export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow';
}

// Pure: pick the on-disk file name for an export. The tab's fileName wins
// whenever it's a valid workflow file name; otherwise fall back to a slug of
// the workflow's display name so exports never silently ignore renames or
// produce an invalid file.
export function exportFileName(fileName: string, name: string): string {
  return FILE_NAME_RE.test(fileName) ? fileName : `${slugify(name)}.yml`;
}

export function downloadYaml(fileName: string, name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/yaml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = exportFileName(fileName, name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}
