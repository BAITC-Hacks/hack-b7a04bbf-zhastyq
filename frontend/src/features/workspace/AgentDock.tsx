import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError, askQuestion } from '../../shared/api/workspace';
import type { AskResponse } from '../../shared/api/types';
import Icon from './Icon';
import './AgentDock.css';

interface AgentDockProps {
  analysisId: string | null;
  selectedGid: string | null;
  configured: boolean | null;
  healthLoading: boolean;
  healthError: string;
  onRefreshHealth: () => void;
  isDemo: boolean;
  onSelectGid: (gid: string) => void;
  onStale: () => void;
}

interface Answer extends AskResponse {
  question: string;
  contextGid: string;
}

export default function AgentDock({ analysisId, selectedGid, configured, healthLoading, healthError, onRefreshHealth, isDemo, onSelectGid, onStale }: AgentDockProps) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [pendingGid, setPendingGid] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const id = useId();
  const contentId = `${id}-content`;
  const questionId = `${id}-question`;
  const explanationId = `${id}-explanation`;
  const disabledReason = isDemo
    ? 'AI-помощник доступен после подключения сервиса анализа и загрузки реальных данных.'
    : !analysisId
      ? 'Загрузите три файла и дождитесь завершения расчёта, чтобы задать вопрос по результатам.'
      : healthLoading
        ? 'Проверяем готовность AI-сервиса…'
        : healthError
          ? `Не удалось проверить AI-сервис. ${healthError}`
          : configured === null
            ? 'Подключение к AI-сервису ещё не проверено. Нажмите «Проверить подключение».'
            : !configured
              ? 'AI-сервис пока не настроен на сервере. Анализ сети и карточки клиентов доступны независимо от помощника.'
              : !selectedGid
                ? 'Выберите клиента в списке или на графе, чтобы добавить его в контекст вопроса.'
                : '';
  const healthStatus = healthLoading ? 'Проверяем подключение…'
    : healthError ? 'Не удалось связаться с сервером'
      : configured === null ? 'Подключение не проверено'
        : configured ? 'AI настроен' : 'AI не настроен на сервере';
  const busy = pendingGid !== null;
  const visibleAnswer = answer?.analysis_id === analysisId ? answer : null;

  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    requestVersion.current += 1;
    setAnswer(null);
    setPendingGid(null);
    setError('');
    setNotice('');
    return () => {
      controller.current?.abort();
      requestVersion.current += 1;
    };
  }, [analysisId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedQuestion = question.trim();
    if (disabledReason || busy || controller.current || !analysisId || !selectedGid || !submittedQuestion || submittedQuestion.length > 2000) return;
    const request = new AbortController();
    controller.current = request;
    const version = ++requestVersion.current;
    const contextGid = selectedGid;
    setPendingGid(contextGid);
    setAnswer(null);
    setError('');
    setNotice('');
    try {
      const response = await askQuestion({
        analysis_id: analysisId,
        question: submittedQuestion,
        context_gids: [contextGid],
      }, request.signal);
      if (request.signal.aborted || version !== requestVersion.current) return;
      if (response.analysis_id !== analysisId) {
        setError('Ответ относится к другому расчёту. Обновите данные и отправьте вопрос заново.');
        onStale();
        return;
      }
      setAnswer({ ...response, question: submittedQuestion, contextGid });
      setNotice(`Ответ по клиенту ${contextGid} получен.`);
    } catch (failure) {
      if (request.signal.aborted || version !== requestVersion.current) return;
      if (failure instanceof ApiError && failure.code === 'NO_ANALYSIS') {
        setError('На сервере нет активного расчёта. Загрузите данные исследования заново.');
        onStale();
      } else if (failure instanceof ApiError && failure.status === 409 && failure.code === 'STALE_ANALYSIS') {
        setError('На сервере появился новый расчёт. Обновляем данные; затем отправьте вопрос ещё раз.');
        onStale();
      } else if (failure instanceof ApiError && failure.status === 503) {
        setError('AI-сервис сейчас недоступен. Попробуйте отправить вопрос позже.');
      } else if (failure instanceof ApiError && failure.code === 'TIMEOUT') {
        setError('Не удалось дождаться ответа AI-сервиса. Вы можете отправить вопрос ещё раз.');
      } else {
        setError(failure instanceof Error ? failure.message : 'Не удалось получить ответ. Попробуйте отправить вопрос ещё раз.');
      }
    } finally {
      if (version === requestVersion.current) {
        controller.current = null;
        setPendingGid(null);
      }
    }
  }

  function cancel() {
    controller.current?.abort();
    controller.current = null;
    requestVersion.current += 1;
    setPendingGid(null);
    setNotice('Ожидание ответа отменено. Сервер мог продолжить обработку вопроса.');
  }

  return (
    <section className={`agent-dock agent-ai${open ? ' agent-dock--open' : ''}`} aria-label="AI-помощник аналитика">
      <button type="button" className="agent-dock__toggle" aria-expanded={open}
        aria-controls={contentId} onClick={() => {
          setOpen(!open);
          if (!open && !isDemo) onRefreshHealth();
        }}>
        <span className="agent-dock__title"><Icon name="sparkle" size={16} />AI-помощник
          <span className="agent-ai__badge">{busy ? 'Готовит ответ' : isDemo ? 'Демо-режим' : !analysisId ? 'Ожидает расчёта' : healthLoading ? 'Проверка подключения' : healthError ? 'Нет связи' : configured === null ? 'Не проверен' : configured ? 'По данным анализа' : 'Не настроен'}</span>
        </span>
        <span className="agent-dock__action">{open ? 'Свернуть' : 'Задать вопрос'}<Icon name="chevron" size={14} style={{ transform: open ? 'rotate(180deg)' : undefined }} /></span>
      </button>
      <div id={contentId} className="agent-dock__content agent-ai__content" hidden={!open}>
        <div className="agent-ai__body">
          <form className="agent-ai__form" onSubmit={submit}>
            <div className="agent-ai__intro">
              <h3>Проверяйте гипотезы по данным</h3>
              <p>Попросите объяснить роль клиента или признаки, на которые стоит обратить внимание.</p>
            </div>
            {!isDemo && <div className={`agent-ai__connection${healthError ? ' agent-ai__connection--error' : ''}`}>
              <span role="status">{healthStatus}</span>
              <button type="button" className="text-button" disabled={healthLoading} onClick={onRefreshHealth}>
                <Icon name="refresh" size={13} />Проверить подключение
              </button>
            </div>}
            <div className="agent-ai__context"><Icon name="network" size={15} /><span>Контекст: <strong>{selectedGid ? `клиент ${selectedGid}` : 'клиент не выбран'}</strong></span></div>
            <label htmlFor={questionId}>Ваш вопрос</label>
            <textarea id={questionId} value={question} maxLength={2000} rows={3}
              disabled={Boolean(disabledReason)} readOnly={busy} aria-describedby={explanationId}
              placeholder="Какие признаки объясняют роль этого клиента?"
              onChange={(event) => setQuestion(event.target.value)} />
            <div className="agent-ai__form-meta"><span>До 2 000 символов</span><span>{question.length.toLocaleString('ru-RU')} / 2 000</span></div>
            <p id={explanationId} className={`agent-ai__explanation${disabledReason ? ' agent-ai__explanation--disabled' : ''}`}>
              {disabledReason || 'По кнопке «Отправить» вопрос и контекст выбранного клиента передаются AI-сервису. Ответ требует проверки аналитиком.'}
            </p>
            <div className="agent-ai__actions">
              <button type="submit" className="agent-ai__submit" disabled={Boolean(disabledReason) || busy || !question.trim()}>
                <Icon name="sparkle" size={16} />{busy ? 'Готовим ответ…' : 'Отправить'}
              </button>
              {busy && <button type="button" className="agent-ai__cancel" onClick={cancel}>Отменить ожидание</button>}
            </div>
          </form>
          <div className="agent-ai__result" aria-busy={busy}>
            {busy && <div className="agent-ai__waiting"><span className="agent-ai__progress" /><h3>Разбираем контекст клиента {pendingGid}</h3><p>Сопоставляем вопрос с результатами текущего анализа.</p></div>}
            {error && <div className="agent-ai__error" role="alert"><Icon name="info" size={18} /><p>{error}</p></div>}
            {!busy && !visibleAnswer && notice && <p className="agent-ai__notice">{notice}</p>}
            {visibleAnswer && <>
              <div className="agent-ai__answer-heading"><h3>Ответ помощника</h3><span>Клиент {visibleAnswer.contextGid}</span></div>
              <p className="agent-ai__asked">{visibleAnswer.question}</p>
              <p className="agent-ai__answer">{visibleAnswer.answer}</p>
              {visibleAnswer.references.length > 0 && <div className="agent-ai__references">
                <h4>Клиенты и факты в ответе</h4>
                {visibleAnswer.references.map((reference, index) => <div className="agent-ai__reference" key={`${reference.gid}-${index}`}>
                  <button type="button" onClick={() => onSelectGid(reference.gid)} aria-label={`Открыть клиента ${reference.gid}`}>
                    <Icon name="network" size={14} />Клиент {reference.gid}<Icon name="arrow" size={14} />
                  </button>
                  {reference.facts.length > 0 && <ul>{reference.facts.map((fact, factIndex) => <li key={factIndex}>{fact}</li>)}</ul>}
                </div>)}
              </div>}
              {visibleAnswer.limitations.length > 0 && <div className="agent-ai__limitations"><h4>Ограничения ответа</h4><ul>{visibleAnswer.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></div>}
              <p className="agent-ai__disclaimer">Роли и приоритеты — аналитические гипотезы, которые требуют проверки.</p>
            </>}
            {!busy && !error && !visibleAnswer && <div className="agent-ai__empty"><Icon name="sparkle" size={26} /><h3>От вопроса к проверяемым фактам</h3><p>Здесь появятся ответ, ссылки на клиентов и ограничения анализа. Вопрос отправляется только по вашему действию.</p></div>}
          </div>
        </div>
      </div>
      <span className="sr-only" role="status" aria-live="polite">{busy ? `Готовится ответ по клиенту ${pendingGid}.` : notice}</span>
    </section>
  );
}
