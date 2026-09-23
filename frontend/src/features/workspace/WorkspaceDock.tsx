import { useEffect, useRef, type ReactNode } from 'react';
import Icon from './Icon';

export default function WorkspaceDock({ side, title, open, busy, count, inactive, onToggle, children }: {
  side: 'left' | 'right'; title: string; open: boolean; busy: boolean; count?: ReactNode;
  inactive: boolean; onToggle: () => void; children: ReactNode;
}) {
  const id = `workspace-${side}`;
  const expandButton = useRef<HTMLButtonElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const focusAfterToggle = useRef(false);
  useEffect(() => {
    if (focusAfterToggle.current) {
      (open ? collapseButton : expandButton).current?.focus();
      focusAfterToggle.current = false;
    }
  }, [open]);
  const toggle = () => { focusAfterToggle.current = true; onToggle(); };

  return <div className={`workspace-dock workspace-dock--${side}`} inert={inactive}>
    <button ref={expandButton} className="workspace-rail" hidden={open} type="button"
      aria-label={`Развернуть: ${title}`} title={`Развернуть: ${title}`} aria-expanded={false} aria-controls={id} onClick={toggle}>
      <Icon name={side === 'left' ? 'panelLeft' : 'panelRight'} size={19} />
      <span className="workspace-rail__title">{title}</span>
      {count !== undefined && <span className="workspace-rail__count">{count}</span>}
    </button>
    <aside id={id} className={`workspace-sidebar ${side === 'left' ? 'top-panel' : 'detail-panel'}`}
      hidden={!open} aria-labelledby={`${id}-title`} aria-busy={busy}>
      <div className="panel-heading">
        <h3 id={`${id}-title`}>{title}</h3>
        {count !== undefined && <span className="count-label">{count}</span>}
        <button ref={collapseButton} className="icon-button sidebar-collapse" type="button"
          aria-label={`Свернуть: ${title}`} title={`Свернуть: ${title}`} aria-expanded={true} aria-controls={id} onClick={toggle}>
          <Icon name="chevron" size={17} style={{ transform: `rotate(${side === 'left' ? 90 : -90}deg)` }} />
        </button>
      </div>
      {children}
    </aside>
  </div>;
}
