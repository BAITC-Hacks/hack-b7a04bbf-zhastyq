import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, askQuestion } from '../../shared/api/workspace';
import type { AiAnswer } from '../../shared/api/types';
import Icon from './Icon';

export default function AgentDock({ analysisId, gid, onSelect, onStale }: {
  analysisId: string | null; gid: string | null; onSelect: (gid: string) => void; onStale: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('Почему этому узлу назначена такая роль? На какие наблюдаемые признаки опирается вывод?');
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const ask = async (event: FormEvent) => {
    event.preventDefault();
    if (!analysisId || !gid || busy) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(''); setAnswer(null);
    try {
      const value = await askQuestion(analysisId, question.trim(), gid, request.signal);
      if (!request.signal.aborted) setAnswer(value);
    } catch (failure) {
      if (request.signal.aborted) return;
      if (failure instanceof ApiError && failure.code === 'STALE_ANALYSIS') {
        await onStale();
      } else setError(failure instanceof Error ? failure.message : 'AI недоступен. Повторите позже.');
    } finally { if (!request.signal.aborted) setBusy(false); }
  };
  return <section className={`agent-dock${open ? ' agent-dock--open' : ''}`} aria-label="AI-агент-чат">
    <button type="button" className="agent-dock__toggle" aria-expanded={open} aria-controls="agent-dock-content" onClick={() => setOpen(!open)}>
      <span className="agent-dock__title"><Icon name="sparkle" size={16} />AI-помощник</span><span>{open ? 'Свернуть' : 'Задать вопрос'}</span>
    </button>
    <div id="agent-dock-content" className="agent-dock__content" hidden={!open}>
      {!gid || !analysisId ? <p>Выберите узел на графе после загрузки анализа.</p> : <div className="ai-conversation">
        <p>Выбран узел {gid}. Модели передаётся ограниченный контекст анализа.</p>
        <form onSubmit={(event) => { void ask(event); }}><label htmlFor="ai-question">Вопрос по выбранному узлу</label>
          <textarea id="ai-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={2000} required />
          <button className="primary-button" disabled={busy || !question.trim()}>{busy ? 'Ожидание ответа…' : 'Спросить AI'}</button>
        </form>
        {error && <div role="alert"><p>{error}</p></div>}
        {answer && <article aria-label="Ответ AI"><p className="ai-answer">{answer.answer}</p>
          {answer.references.map((reference) => <div key={reference.gid}><button className="text-button gid-link" onClick={() => onSelect(reference.gid)}>{reference.gid}</button><ul>{reference.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul></div>)}
          <h3>Ограничения</h3><ul>{answer.limitations.map((text) => <li key={text}>{text}</li>)}</ul>
        </article>}
      </div>}
    </div>
  </section>;
}
