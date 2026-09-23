import { useEffect, useRef, useState } from 'react';
import ImportSlot, { statusLabels } from './ImportSlot';
import Icon from './Icon';
import { emptySlots, importKeys, validateParquetFile } from './importModel';
import type { ImportKey, ImportSlots, PipelineStatus, StartImport } from './importModel';
import './DataImport.css';

export default function DataImport({ startImport }: { startImport?: StartImport }) {
  const [slots, setSlots] = useState(emptySlots);
  const [pipeline, setPipeline] = useState<PipelineStatus>('idle');
  const [pipelineError, setPipelineError] = useState('');
  const [inFlight, setInFlight] = useState(false);
  const [compact, setCompact] = useState(false);
  const revisions = useRef({ edges: 0, nodes: 0, transactions: 0 });
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);

  const choose = async (key: ImportKey, files: File[]) => {
    if (inFlight) return;
    setCompact(false);
    const revision = ++revisions.current[key];
    setPipeline('idle'); setPipelineError('');
    if (files.length !== 1) {
      setSlots((old) => ({ ...old, [key]: { status: 'error', error: 'Выберите один файл для этого слота.', revision } }));
      return;
    }
    const file = files[0];
    setSlots((old) => ({ ...old, [key]: { status: 'validating', file, revision } }));
    const error = await validateParquetFile(file);
    if (!mounted.current || revision !== revisions.current[key]) return;
    setSlots((old) => ({ ...old, [key]: { status: error ? 'error' : 'selected', file, error: error ?? undefined, revision } }));
  };
  const remove = (key: ImportKey) => {
    if (inFlight) return;
    const revision = ++revisions.current[key];
    setSlots((old) => ({ ...old, [key]: { status: 'empty', revision } }));
    setPipeline('idle'); setPipelineError('');
  };
  const selectedCount = importKeys.filter((key) => ['selected', 'ready'].includes(slots[key].status)).length;
  const readyCount = importKeys.filter((key) => slots[key].status === 'ready').length;
  const canStart = !!startImport && selectedCount === 3 && !inFlight;
  const start = async () => {
    if (!canStart || !startImport || request.current) return;
    const controller = new AbortController(); request.current = controller;
    setInFlight(true); setPipeline('uploading'); setPipelineError('');
    let current: ImportSlots = { ...slots };
    for (const key of importKeys) current[key] = { ...current[key], status: 'uploading', progress: undefined, error: undefined };
    setSlots(current);
    const outcome: { status: PipelineStatus } = { status: 'uploading' };
    try {
      await startImport({ edges: slots.edges.file!, nodes: slots.nodes.file!, transactions: slots.transactions.file! }, (event) => {
        if (controller.signal.aborted || !mounted.current || request.current !== controller) return;
        if (event.type === 'file') {
          current = { ...current, [event.key]: { ...current[event.key], status: event.status, progress: event.progress,
            error: event.status === 'error' ? event.error || 'Файл не прошёл проверку.' : undefined } };
          setSlots(current);
        } else {
          if ((event.status === 'running' || event.status === 'complete') && !importKeys.every((key) => current[key].status === 'ready')) return;
          outcome.status = event.status; setPipeline(event.status); setPipelineError(event.error || '');
        }
      }, controller.signal);
      if (outcome.status !== 'complete' && outcome.status !== 'error' && !controller.signal.aborted) throw new Error('Сервис не подтвердил завершение расчёта.');
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) {
        setPipeline('error'); setPipelineError(error instanceof Error ? error.message : 'Не удалось отправить данные. Повторите попытку.');
      }
    } finally {
      if (mounted.current && !controller.signal.aborted) {
        setSlots((old) => {
          const next = { ...old };
          for (const key of importKeys) if (['uploading', 'checking'].includes(next[key].status)) next[key] = { ...next[key], status: 'selected', progress: undefined };
          return next;
        });
        setInFlight(false);
      }
      request.current = null;
    }
  };
  const status = pipeline === 'error' ? pipelineError || 'Расчёт не завершён. Проверьте ошибки файлов.'
    : pipeline === 'complete' ? 'Расчёт завершён'
    : pipeline === 'running' ? 'Файлы готовы · расчёт выполняется…'
    : pipeline === 'checking' ? 'Проверка данных…'
    : pipeline === 'uploading' ? 'Отправка набора…'
    : selectedCount === 3 && !startImport ? 'Файлы выбраны. Сервис анализа ещё не подключён.'
    : `Выбрано ${selectedCount} из 3 файлов`;

  return <section className={`data-import panel${compact ? ' data-import--compact' : ''}`} aria-labelledby="import-title">
    <div className="data-import__heading">
      <div className="data-import__title"><span className="import-symbol"><Icon name="upload" size={19} /></span><div><h2 id="import-title">Данные исследования</h2><p className="secondary">{compact ? status : 'Три файла Parquet для одного расчёта'}</p></div></div>
      {compact && <div className="import-summary" aria-label="Состояние файлов">{importKeys.map((key) => <span className={'import-summary__file' + (slots[key].status === 'error' ? ' import-summary__file--error' : '')} key={key} title={(slots[key].file?.name || key + '.parquet') + ' · ' + (slots[key].error || statusLabels[slots[key].status])}><Icon name={slots[key].status === 'selected' || slots[key].status === 'ready' ? 'check' : 'upload'} size={13} /><span>{key}.parquet</span><span className="sr-only">{statusLabels[slots[key].status]}</span></span>)}</div>}
      <button className="import-toggle" type="button" aria-expanded={!compact} aria-controls="import-controls" onClick={() => setCompact(!compact)}>{compact ? 'Импорт файлов' : 'Свернуть'}<Icon name="chevron" size={15} style={{ transform: compact ? undefined : 'rotate(180deg)' }} /></button>
    </div>
    <div id="import-controls" hidden={compact}>
    <div className="data-import__slots">{importKeys.map((key) => <ImportSlot key={key} name={key} state={slots[key]} locked={inFlight} onChoose={(files) => { void choose(key, files); }} onRemove={() => remove(key)} />)}</div>
    <div className={`pipeline-status pipeline-status--${pipeline}`}>
      <div id="pipeline-description" role={pipeline === 'error' ? 'alert' : 'status'}>
        <span className="pipeline-status__indicator" aria-hidden="true" /><span>{status}</span>
        {readyCount > 0 && pipeline !== 'idle' && <span className="secondary">Файлы готовы: {readyCount}/3</span>}
      </div>
      <button className="primary-button" type="button" disabled={!canStart} aria-describedby="pipeline-description import-availability" onClick={() => { void start(); }}>Загрузить и запустить</button>
    </div>
    <p id="import-availability" className="data-import__availability">{startImport ? 'Структура колонок проверяется сервисом после отправки.' : 'Доступна локальная проверка файла. Отправка и расчёт появятся после подключения сервиса.'}</p>
    </div>
  </section>;
}
