import type { NodeDetails } from '../../shared/contracts';
import PriorityIndicator from './PriorityIndicator';
import { formatMoney, formatScore, roleLabels } from './labels';

export default function NodeCard({ node }: { node: NodeDetails }) {
  return (
    <div className={`node-card${node.priority_score >= 0.8 ? ' node-card--high' : ''}`}>
      <div>
        <p className="eyebrow">Клиент</p>
        <h3 className="node-card__gid">{node.gid}</h3>
        <p className="node-card__role">{roleLabels[node.role]}</p>
      </div>
      <dl className="node-facts">
        <div><dt>Приоритет</dt><dd><PriorityIndicator score={node.priority_score} /></dd></div>
        <div><dt>Сила признаков роли</dt><dd>{formatScore(node.role_score)}</dd></div>
        <div><dt>Кластер</dt><dd>{node.cluster_id}</dd></div>
        <div><dt>Глубина / seed</dt><dd>{node.depth} / {node.is_seed ? 'Да' : 'Нет'}</dd></div>
      </dl>
      <section className="node-card__section">
        <h3>Наблюдаемый поток</h3>
        <dl className="flow-metrics">
          <div><dt>Входящие переводы</dt><dd>{formatMoney(node.incoming_sum_kzt)}</dd></div>
          <div><dt>Исходящие переводы</dt><dd>{formatMoney(node.outgoing_sum_kzt)}</dd></div>
        </dl>
        <p className="secondary">{node.unique_payers} плательщика · {node.unique_recipients} получателя</p>
      </section>
      <section className="node-card__section">
        <h3>Почему проверить</h3>
        <p>{node.evidence}</p>
        <p className="secondary">Роль — гипотеза. Суммы отражают только доступную выборку.</p>
      </section>
    </div>
  );
}
