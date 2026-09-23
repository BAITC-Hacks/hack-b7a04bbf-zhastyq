import { useState } from 'react';
import type { GraphSlice, NodeDetails, NodeSummary } from '../../shared/contracts';
import Icon from './Icon';
import { formatMoney, formatScore, roleLabels } from './labels';
import { flowInSlice } from './workspaceModel';

export default function NodeCard({ node, detail, graph }: { node: NodeSummary; detail: NodeDetails | null; graph: GraphSlice | null }) {
  const [copyStatus, setCopyStatus] = useState('');
  const flow = detail || flowInSlice(graph, node.gid);
  const high = node.priority_score >= 0.8;
  const copy = async () => {
    try { await navigator.clipboard.writeText(node.gid); setCopyStatus('gid скопирован'); }
    catch { setCopyStatus('Не удалось скопировать. Выделите gid вручную.'); }
  };
  return <div className="node-card">
    <div className="node-card__identity">
      <span className="node-avatar"><Icon name="network" size={22} /></span>
      <div><p className="eyebrow">КЛИЕНТ</p><h3 className="node-card__gid">{node.gid}</h3></div>
      <button type="button" className="icon-button" aria-label="Скопировать gid" title="Скопировать gid" onClick={() => { void copy(); }}><Icon name={copyStatus === 'gid скопирован' ? 'check' : 'copy'} size={16} /></button>
    </div>
    {copyStatus && <p className="copy-status" role="status">{copyStatus}</p>}
    <div className="node-card__role"><span>{roleLabels[node.role]}</span><span className="secondary">Кластер {node.cluster_id}</span></div>
    <section className={'priority-summary' + (high ? ' priority-summary--high' : '')} aria-label="Приоритет проверки">
      <div><span>Приоритет проверки</span><strong>{formatScore(node.priority_score)}<span> / 1</span></strong></div>
      <div className="priority-meter" role="meter" aria-label="Приоритет" aria-valuemin={0} aria-valuemax={1} aria-valuenow={node.priority_score}><span style={{ width: Math.max(0, Math.min(1, node.priority_score)) * 100 + '%' }} /></div>
      <p>{high ? 'Высокий приоритет · рекомендуется проверить' : 'Приоритет по структурным признакам'}</p>
    </section>
    <dl className="node-facts">
      <div><dt>Сила признаков роли</dt><dd>{formatScore(node.role_score)}</dd></div>
      <div><dt>Глубина связей</dt><dd>{node.depth}</dd></div>
      <div><dt>Исходный узел (seed)</dt><dd>{node.is_seed ? 'Да' : 'Нет'}</dd></div>
    </dl>
    <section className="node-card__section">
      <h3>{detail ? 'Наблюдаемый поток' : flow ? 'Поток в показанном срезе' : 'Денежные потоки'}</h3>
      {flow ? <><dl className="flow-metrics">
        <div><dt><span className="flow-arrow">↙</span>Входящие</dt><dd>{formatMoney(flow.incoming_sum_kzt)}</dd></div>
        <div><dt><span className="flow-arrow flow-arrow--out">↗</span>Исходящие</dt><dd>{formatMoney(flow.outgoing_sum_kzt)}</dd></div>
      </dl><div className="counterparties"><span>Плательщики <strong>{flow.unique_payers}</strong></span><span>Получатели <strong>{flow.unique_recipients}</strong></span></div></>
        : <p className="secondary">Детализация переводов для этого клиента пока не получена.</p>}
    </section>
    <section className="node-card__section evidence-section">
      <h3><Icon name="info" size={16} />Основание для проверки</h3>
      <p>{node.evidence || 'Описание признаков пока не получено.'}</p>
    </section>
    <p className="node-card__disclaimer">Выводы ограничены доступной выборкой. Роль не подтверждает нарушение.</p>
  </div>;
}
