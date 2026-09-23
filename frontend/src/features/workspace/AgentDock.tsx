import { useState } from 'react';

export default function AgentDock() {
  const [open, setOpen] = useState(false);
  return (
    <section className={`agent-dock${open ? ' agent-dock--open' : ''}`} aria-label="AI-агент-чат">
      <button type="button" className="agent-dock__toggle" aria-expanded={open}
        aria-controls="agent-dock-content" onClick={() => setOpen(!open)}>
        <span>AI-агент-чат</span>
        <span className="agent-dock__action">{open ? 'Свернуть' : 'Открыть'} <span aria-hidden="true">{open ? '⌄' : '⌃'}</span></span>
      </button>
      <div id="agent-dock-content" className="agent-dock__content" hidden={!open}>
        <p>Панель помощника — скоро</p>
      </div>
    </section>
  );
}
