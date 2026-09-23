import { roleLabels } from '../workspace/labels';
import { roles, type GraphDisplay, type GraphFilters, type GraphForces } from './graphModel';

export function GraphIcon({ name }: { name: 'settings' | 'reset' | 'close' | 'search' | 'fit' | 'focus' }) {
  const paths = {
    settings: 'M3 5h10m4 0h4M3 12h3m4 0h11M3 19h10m4 0h4M13 2v6M6 9v6m7 1v6',
    reset: 'M4 10a8 8 0 1 1 1 7M4 4v6h6', close: 'm6 6 12 12M18 6 6 18',
    search: 'm16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    fit: 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6',
    focus: 'M12 2v4m0 12v4M2 12h4m12 0h4M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0',
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="aml-graph__toggle"><span>{label}</span><input type="checkbox" role="switch"
    checked={checked} onChange={event => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}
function Slider({ label, value, min, max, step = 0.05, onChange, suffix = '' }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void; suffix?: string;
}) {
  return <label className="aml-graph__slider"><span>{label}<output>{value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}{suffix}</output></span>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value}
      onChange={event => onChange(event.target.valueAsNumber)} /></label>;
}
export function GraphControls({ filters, onFilters, display, onDisplay, forces, onForces, clusters, depths }: {
  filters: GraphFilters; onFilters: (value: GraphFilters) => void;
  display: GraphDisplay; onDisplay: (value: GraphDisplay) => void;
  forces: GraphForces; onForces: (value: GraphForces) => void; clusters: number[]; depths: number[];
}) {
  return <>
    <div className="aml-graph__toggles">
      <Toggle label="Только seed" checked={filters.seedOnly} onChange={seedOnly => onFilters({ ...filters, seedOnly })} />
      <Toggle label="Изолированные узлы" checked={filters.isolated} onChange={isolated => onFilters({ ...filters, isolated })} />
    </div>
    <details className="aml-graph__section"><summary>Фильтры</summary><div className="aml-graph__fields">
      <label>Роль<select aria-label="Роль" value={filters.role} onChange={event => onFilters({ ...filters, role: event.target.value })}>
        <option value="all">Все роли</option>{roles.map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}
      </select></label>
      <label>Кластер<select aria-label="Кластер" value={filters.cluster} onChange={event => onFilters({ ...filters, cluster: event.target.value })}>
        <option value="all">Все кластеры</option>{clusters.map(cluster => <option key={cluster} value={String(cluster)}>{cluster}</option>)}
      </select></label>
      {!!depths.length && <label>Глубина<select aria-label="Глубина" value={filters.depth} onChange={event => onFilters({ ...filters, depth: event.target.value })}>
        <option value="all">Все глубины</option>{depths.map(depth => <option key={depth} value={String(depth)}>{depth}</option>)}
      </select></label>}
    </div></details>
    <details className="aml-graph__section"><summary>Отображение</summary><div className="aml-graph__fields">
      <Toggle label="Подписи при приближении" checked={display.labels} onChange={labels => onDisplay({ ...display, labels })} />
      <Toggle label="Стрелки переводов" checked={display.arrows} onChange={arrows => onDisplay({ ...display, arrows })} />
      <label>Цвет узлов<select aria-label="Цвет узлов" value={display.color} onChange={event => onDisplay({ ...display, color: event.target.value as GraphDisplay['color'] })}>
        <option value="role">По роли</option><option value="cluster">По кластеру</option>
      </select></label>
      <Slider label="Размер узлов" value={display.nodeScale} min={0.5} max={1.8} suffix="×" onChange={nodeScale => onDisplay({ ...display, nodeScale })} />
      <Slider label="Видимость рёбер" value={display.edgeOpacity} min={0.05} max={1} step={0.01} onChange={edgeOpacity => onDisplay({ ...display, edgeOpacity })} />
      <p className="aml-graph__hint">У выбранного узла подпись видна всегда.</p>
    </div></details>
    <details className="aml-graph__section" open><summary>Силы</summary><div className="aml-graph__fields">
      <Slider label="К центру" value={forces.center} min={0} max={2} onChange={center => onForces({ ...forces, center })} />
      <Slider label="Отталкивание" value={forces.repulsion} min={0.2} max={4} suffix="×" onChange={repulsion => onForces({ ...forces, repulsion })} />
      <Slider label="Сила связей" value={forces.strength} min={0.2} max={3} suffix="×" onChange={strength => onForces({ ...forces, strength })} />
      <Slider label="Длина связей" value={forces.distance} min={0.4} max={3} suffix="×" onChange={distance => onForces({ ...forces, distance })} />
      <p className="aml-graph__hint">Меняет расположение, а не данные.</p>
    </div></details>
  </>;
}
