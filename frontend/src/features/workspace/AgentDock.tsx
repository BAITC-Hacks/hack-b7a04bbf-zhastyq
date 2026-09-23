import { useState } from 'react';
import Icon from './Icon';

export default function AgentDock() {
  const [open, setOpen] = useState(false);
  return (
    <section className={`agent-dock${open ? ' agent-dock--open' : ''}`} aria-label="AI-агент-чат">
      <button type="button" className="agent-dock__toggle" aria-expanded={open}
        aria-controls="agent-dock-content" onClick={() => setOpen(!open)}>
        <span className="agent-dock__title"><Icon name="sparkle" size={16} />AI-помощник<span className="planned-label">Планируется</span></span>
        <span className="agent-dock__action">{open ? 'Свернуть' : 'Подробнее'}<Icon name="chevron" size={14} style={{ transform: open ? undefined : 'rotate(180deg)' }} /></span>
      </button>
      <div id="agent-dock-content" className="agent-dock__content" hidden={!open}>
        <Icon name="sparkle" size={28} /><div><h3>Дополнительный взгляд на связи</h3><p>Здесь появится помощник для вопросов по выбранному узлу и объяснения маршрутов переводов. Чат пока не подключён; данные никуда не отправляются.</p></div>
      </div>
    </section>
  );
}
