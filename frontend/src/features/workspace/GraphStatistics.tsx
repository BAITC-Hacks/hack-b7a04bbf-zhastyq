import { useMemo } from 'react';
import type { GraphSlice } from '../../shared/contracts';
import { formatMoney } from './labels';
import { summarizeGraph } from './statistics';

const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const compactMoney = (value: number) => new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 2 }).format(value) + ' ₸';
const percent = (value: number | null | undefined) => value == null ? '—' : `${decimal.format(value * 100)}%`;

export default function GraphStatistics({ graph, loading, full = false }: { graph: GraphSlice | null; loading: boolean; full?: boolean }) {
  const stats = useMemo(() => graph ? summarizeGraph(graph) : null, [graph]);
  const unavailable = loading || !stats;
  return (
    <section className="statistics panel" aria-label={full ? 'Статистика всего анализа' : 'Статистика текущего среза'} aria-busy={loading}>
      <div className="statistics__scope">
        <h2>Обзор сети</h2>
        <span>{loading ? 'Загрузка данных…' : stats ? `${full ? 'Весь анализ' : 'Демонстрационный срез'} · ${stats.count} узлов` : 'Данные не загружены'}</span>
      </div>
      <dl className="statistics__grid">
        <div><dt>Оборот переводов</dt><dd>{unavailable ? '—' : <span className="metric-value" tabIndex={0} aria-label={formatMoney(stats.turnover)}><span aria-hidden="true">{compactMoney(stats.turnover)}</span><span className="metric-value__exact" aria-hidden="true">{formatMoney(stats.turnover)}</span></span>}</dd><span>{full ? 'по всем рёбрам анализа' : 'по рёбрам среза'}</span></div>
        <div><dt>Высокий приоритет</dt><dd>{unavailable ? '—' : percent(stats.highShare)}</dd><span>{unavailable ? 'Нет данных' : `${stats.highCount} из ${stats.count} узлов · ≥ 0,80`}</span></div>
        <div><dt>Кластеры</dt><dd>{unavailable ? '—' : stats.clusterCount}</dd><span>{unavailable || stats.averageClusterSize === null ? 'Средний размер —' : `Средний размер: ${decimal.format(stats.averageClusterSize)}`}</span></div>
        <div><dt>Консолидация / координация</dt><dd>{unavailable ? '—' : `${stats.consolidators} / ${stats.coordinators}`}</dd><span>кандидаты для проверки</span></div>
        <div><dt>Вне крупнейшей компоненты</dt><dd>{unavailable ? '—' : percent(stats.outsideShare)}</dd><span>{unavailable ? 'Нет данных' : `${stats.outsideCount} из ${stats.count} узлов · слабая связность`}</span></div>
      </dl>
    </section>
  );
}
