import type { ReactNode } from 'react';

export default function WorkspaceState({ title, children, error = false }: {
  title: string;
  children?: ReactNode;
  error?: boolean;
}) {
  return (
    <div className={`workspace-state${error ? ' workspace-state--error' : ''}`}
      role={error ? 'alert' : 'status'}>
      <p className="workspace-state__title">{title}</p>
      {children && <div>{children}</div>}
    </div>
  );
}
