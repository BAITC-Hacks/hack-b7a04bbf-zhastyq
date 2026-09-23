import { useEffect, useRef, useState } from 'react';
import { ApiError, downloadExport, isDemo } from '../../shared/api/workspace';
import type { ExportName } from '../../shared/api/types';
import Icon from './Icon';

const names: ExportName[] = ['nodes_roles.csv', 'clusters.csv', 'top_nodes.csv'];

export default function ExportMenu({ analysisId, onFiltered, onStale, announce, disabled }: {
  analysisId: string | null; onFiltered: () => void; onStale: () => void;
  announce: (message: string) => void; disabled: boolean;
}) {
  const [name, setName] = useState<ExportName | 'filtered'>('nodes_roles.csv');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { request.current?.abort(); setBusy(false); return () => request.current?.abort(); }, [analysisId]);
  const download = async () => {
    if (isDemo || name === 'filtered') { onFiltered(); return; }
    if (!analysisId || busy) return;
    const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      const file = await downloadExport(name, analysisId, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a'); link.href = url; link.download = file.filename;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce('Подготовлен ' + file.filename + ' для текущего анализа.');
    } catch (error) {
      if (controller.signal.aborted) return;
      announce(error instanceof Error ? error.message : 'Не удалось скачать CSV.');
      if (error instanceof ApiError && ['STALE_ANALYSIS', 'NO_ANALYSIS'].includes(error.code)) onStale();
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };
  return <div className="export-controls">
    {!isDemo && <label><span className="sr-only">Файл экспорта</span><select aria-label="Файл экспорта" value={name} disabled={busy} onChange={(event) => setName(event.target.value as typeof name)}>
      {names.map((item) => <option key={item} value={item}>{item}</option>)}<option value="filtered">Текущий список</option>
    </select></label>}
    <button type="button" className="export-button" disabled={busy || disabled || (!isDemo && !analysisId)} onClick={() => { void download(); }}><Icon name="download" />{busy ? 'Подготовка…' : 'Экспорт'}<span className="export-button__format">CSV</span></button>
  </div>;
}
