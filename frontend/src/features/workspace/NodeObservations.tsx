import type { NodeCardData, TemporalPattern } from '../../shared/api/types';
import { formatMoney } from './labels';

const names = { rapid_outflow: 'Быстрое последующее перечисление', synchronized_inflow: 'Синхронные поступления', activity_spike: 'Всплеск активности' };
function Pattern({ item, onSelect }: { item: TemporalPattern; onSelect: (gid: string) => void }) {
  return <details className="temporal-item"><summary>{item.date} · {names[item.kind]}</summary>
    {item.kind === 'rapid_outflow' && <><p>Входящие: {item.incoming_n_tx} операций · {formatMoney(item.incoming_sum_kzt)}</p>
      {item.outgoing_days.map((day) => <p key={day.date}>{day.date}: через {day.interval_days} дн. · {day.n_tx} операций · {formatMoney(day.sum_kzt)}</p>)}</>}
    {item.kind === 'synchronized_inflow' && <><p>{item.n_senders} отправителей · {item.n_tx} операций · {formatMoney(item.sum_kzt)}</p>
      {item.sender_gids.map((gid) => <button className="text-button gid-link" key={gid} onClick={() => onSelect(gid)}>{gid}</button>)}</>}
    {item.kind === 'activity_spike' && <><p>{item.n_tx} операций · {formatMoney(item.sum_kzt)}; среднее {item.average_daily_n_tx.toFixed(3)} операций/день; превышение {item.multiple.toFixed(2)}×.</p>
      <p>Период {item.period_start} — {item.period_end} ({item.period_days} дней); всего {item.period_n_tx} операций. Пороги: ≥{item.min_daily_n_tx} операций и ≥{item.min_multiple}× среднего.</p></>}
    <p>{item.explanation}</p><ul>{item.limitations.map((text) => <li key={text}>{text}</li>)}</ul>
  </details>;
}
export default function NodeObservations({ card, onSelect }: { card: NodeCardData; onSelect: (gid: string) => void }) {
  return <>
    {(['incoming', 'outgoing'] as const).map((direction) => <section className="node-card__section" key={direction}>
      <h3>{direction === 'incoming' ? 'Входящие связи' : 'Исходящие связи'} ({card[direction].length})</h3>
      {!card[direction].length && <p>Наблюдаемых связей нет.</p>}
      <ul className="edge-list">{card[direction].map((edge) => <li key={edge.source + ':' + edge.target}>
        <button className="text-button gid-link" onClick={() => onSelect(direction === 'incoming' ? edge.source : edge.target)}>{edge.source} → {edge.target}</button>
        <span>{formatMoney(edge.sum_kzt)} · {edge.n_tx} операций</span>
      </li>)}</ul>
    </section>)}
    <section className="node-card__section"><h3>Полнота наблюдения</h3>
      {card.data_gaps.map((gap) => <div className="data-gap" key={gap.code}>
        <p>{gap.description}</p><code>{gap.evidence}</code>
        {card.next_requests.filter((request) => request.gap_code === gap.code).map((request) => <p key={request.gap_code}><strong>Следующий запрос: </strong>{request.request}<br />{request.reason}</p>)}
      </div>)}
      <ul>{card.limitations.map((text) => <li key={text}>{text}</li>)}</ul>
    </section>
    <section className="node-card__section"><h3>Временные наблюдения ({card.temporal_patterns.total_count})</h3>
      {card.temporal_patterns.truncated && <p>Показаны первые 50 наблюдений по дате; полный счётчик указан выше.</p>}
      {!card.temporal_patterns.total_count && <p>По применённым правилам наблюдений не найдено.</p>}
      {card.temporal_patterns.items.map((item) => <Pattern key={item.kind + item.date} item={item} onSelect={onSelect} />)}
    </section>
  </>;
}
