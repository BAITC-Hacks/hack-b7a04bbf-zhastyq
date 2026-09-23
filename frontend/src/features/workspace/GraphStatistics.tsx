import { useMemo } from 'react';
import type { GraphSlice } from '../../shared/contracts';
import { formatMoney } from './labels';
import { summarizeGraph } from './statistics';

const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const percent = (value: number | null | undefined) => value == null ? '—' : `${decimal.format(value * 100)}%`;

export default function GraphStatistics({ graph, loading }: { graph: GraphSlice | null; loading: boolean }) {
  const stats = useMemo(() => graph ? summarizeGraph(graph) : null, [graph]);
  const unavailable = loading || !stats;
  return (
    <section className="statistics panel" aria-label="Статистика текущего среза" aria-busy={loading}>
      <div className="statistics__scope">
        <h2>Обзор сети</h2>
        <span>{loading ? 'Загрузка среза…' : stats ? `Текущий срез · ${stats.count} узлов` : 'Срез не загружен'}</span>
      </div>
      <dl className="statistics__grid">
        <div><dt>Оборот переводов</dt><dd>{unavailable ? '—' : formatMoney(stats.turnover)}</dd><span>по рёбрам среза</span></div>
        <div><dt>Высокий приоритет</dt><dd>{unavailable ? '—' : percent(stats.highShare)}</dd><span>{unavailable ? 'Нет данных' : `${stats.highCount} из ${stats.count} узлов · ≥ 0,80`}</span></div>
        <div><dt>Кластеры</dt><dd>{unavailable ? '—' : stats.clusterCount}</dd><span>{unavailable || stats.averageClusterSize === null ? 'Средний размер —' : `Средний размер: ${decimal.format(stats.averageClusterSize)}`}</span></div>
        <div><dt>Консолидация / координация</dt><dd>{unavailable ? '—' : `${stats.consolidators} / ${stats.coordinators}`}</dd><span>кандидаты для проверки</span></div>
        <div><dt>Вне крупнейшей компоненты</dt><dd>{unavailable ? '—' : percent(stats.outsideShare)}</dd><span>{unavailable ? 'Нет данных' : `${stats.outsideCount} из ${stats.count} узлов · слабая связность`}</span></div>
      </dl>
    </section>
  );
}
