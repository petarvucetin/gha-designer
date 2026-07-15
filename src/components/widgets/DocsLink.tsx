import type { ReactNode } from 'react';

export default function DocsLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a className="docs-link" href={href} target="_blank" rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}>
      {children ?? 'docs'} ↗
    </a>
  );
}
