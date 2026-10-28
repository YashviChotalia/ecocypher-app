import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { DEMAND_THRESHOLD_KW, OVERLOAD_KW, PEAK_END, PEAK_START, type HourResult } from '../lib/microgrid/engine';
import { fmtNum } from '../lib/format';

const padL = 40, padR = 10, padT = 14;

/** Track the plot's real pixel width so text and strokes are never stretched. */
function useWidth(): [RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
const hh = (t: string) => t.slice(11, 13);
const label = (t: string) => `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`;
export const MODE_LABEL = { RENEWABLE_STORAGE: 'Battery storage', MAIN_GRID: 'Main grid' } as const;

function nice(max: number, step: number) { return Math.ceil(max / step) * step; }

/** Predicted load curve: 160/200 kW thresholds, 18–22h window shading, points by grid mode, mode strip. */
export function LoadCurve({ hours }: { hours: HourResult[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const [ref, W] = useWidth();
  const H = 250, padB = 40;
  const n = hours.length;
  const top = nice(Math.max(220, ...hours.map((h) => h.predicted_kw)) * 1.05, 50);
  const step = (W - padL - padR) / Math.max(1, n);
  const x = (i: number) => padL + step * i + step / 2;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const base = H - padB;
  const line = hours.map((h, i) => `${i ? 'L' : 'M'}${x(i)},${y(h.predicted_kw)}`).join(' ');
  const area = n ? `${line} L${x(n - 1)},${base} L${x(0)},${base} Z` : '';
  const ticks = Array.from({ length: top / 50 + 1 }, (_, i) => i * 50);
  const every = W < 480 ? (n > 16 ? 3 : n > 8 ? 2 : 1) : n > 16 ? 2 : 1;

  return (
    <figure className="chart" aria-labelledby={`${id}-t`}>
      <figcaption className="chart-head">
        <span id={`${id}-t`} className="chart-title">Demand <small className="muted">kW</small></span>
        <span className="legend">
          <span><i style={{ ['--c' as string]: 'var(--mode-batt)' }} />Battery</span>
          <span><i style={{ ['--c' as string]: 'var(--mode-grid)' }} />Grid</span>
          <span><i className="ring" />Overload</span>
          <span><i className="band" />18–22h</span>
        </span>
        <button className="link-btn" onClick={() => setTable((t) => !t)} aria-pressed={table}>{table ? 'Chart' : 'Table'}</button>
      </figcaption>
      {table ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Hour</th><th className="num">Demand kW</th><th>Mode</th><th>Alert</th></tr></thead>
            <tbody>{hours.map((h) => (
              <tr key={h.timestamp}><td>{label(h.timestamp)}</td><td className="num">{fmtNum(h.predicted_kw, 2)}</td>
                <td>{MODE_LABEL[h.grid_mode]}</td><td>{h.overload_alert ? <span className="tag fail">Overload</span> : '—'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="chart-plot grid-plot" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Predicted demand in kW for ${n} hours; peak ${fmtNum(Math.max(...hours.map((h) => h.predicted_kw)), 1)} kW`} width={W} height={H}>
            {hours.map((h, i) => (h.hour >= PEAK_START && h.hour <= PEAK_END
              ? <rect key={`p${i}`} x={x(i) - step / 2} y={padT} width={step} height={base - padT} className="peak-band" /> : null))}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="grid" />
                <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="tick">{t}</text>
              </g>
            ))}
            <line x1={padL} x2={W - padR} y1={y(DEMAND_THRESHOLD_KW)} y2={y(DEMAND_THRESHOLD_KW)} className="thr thr-switch" />
            <line x1={padL} x2={W - padR} y1={y(OVERLOAD_KW)} y2={y(OVERLOAD_KW)} className="thr thr-over" />
            <text x={padL + 4} y={y(DEMAND_THRESHOLD_KW) + 13} className="thr-label">160</text>
            <text x={padL + 4} y={y(OVERLOAD_KW) - 5} className="thr-label over">200 overload</text>
            <path d={area} className="load-area" />
            <path d={line} className="load-line" />
            {hours.map((h, i) => (
              <g key={h.timestamp} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)} tabIndex={0} className="col">
                <rect x={x(i) - step / 2} y={padT} width={step} height={H - padT} className="hit" />
                {hover === i && <line x1={x(i)} x2={x(i)} y1={padT} y2={base} className="cursor" />}
                <circle cx={x(i)} cy={y(h.predicted_kw)} r={hover === i ? 5 : 3.2} className={`pt ${h.grid_mode === 'RENEWABLE_STORAGE' ? 'batt' : 'gridm'}${h.overload_alert ? ' over' : ''}`} />
                <rect x={x(i) - step / 2 + 1} y={base + 5} width={Math.max(1, step - 2)} height={4} rx={2} className={`strip ${h.grid_mode === 'RENEWABLE_STORAGE' ? 'batt' : 'gridm'}`} />
                {i % every === 0 && <text x={x(i)} y={H - 10} textAnchor="middle" className="tick">{hh(h.timestamp)}</text>}
              </g>
            ))}
          </svg>
          {hover != null && hours[hover] && (
            <div className="tooltip" style={{ left: `${Math.min(82, Math.max(18, (x(hover) / W) * 100))}%` }} role="status">
              <b>{label(hours[hover].timestamp)}</b>
              <span>Demand<em>{fmtNum(hours[hover].predicted_kw, 1)} kW</em></span>
              <span><i style={{ ['--c' as string]: hours[hover].grid_mode === 'RENEWABLE_STORAGE' ? 'var(--mode-batt)' : 'var(--mode-grid)' }} />{MODE_LABEL[hours[hover].grid_mode]}<em>{hours[hover].overload_alert ? 'OVERLOAD' : ''}</em></span>
              <span>Battery SoC<em>{fmtNum(hours[hover].soc_pct, 1)}%</em></span>
              <span>Solar PV<em>{fmtNum(hours[hover].pv_kw, 0)} kW</em></span>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

/** Battery state of charge over the forecast window with the reserve floor. */
export function SocChart({ hours, reserve }: { hours: HourResult[]; reserve: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  const H = 150, padB = 24;
  const n = hours.length;
  const step = (W - padL - padR) / Math.max(1, n);
  const x = (i: number) => padL + step * i + step / 2;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / 100);
  const pts = [{ x: padL, v: hours[0]?.soc_start_pct ?? 0 }, ...hours.map((h, i) => ({ x: x(i), v: h.soc_pct }))];
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${y(p.v)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1].x},${y(0)} L${padL},${y(0)} Z`;
  const every = W < 480 ? (n > 16 ? 3 : n > 8 ? 2 : 1) : n > 16 ? 2 : 1;
  return (
    <figure className="chart">
      <figcaption className="chart-head"><span className="chart-title">Battery charge <small className="muted">%</small></span></figcaption>
      <div ref={ref} className="chart-plot soc-plot" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Battery state of charge from ${fmtNum(pts[0].v, 0)}% to ${fmtNum(pts[pts.length - 1].v, 0)}%`} width={W} height={H}>
          {[0, 25, 50, 75, 100].map((t) => (
            <g key={t}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="grid" /><text x={padL - 6} y={y(t) + 4} textAnchor="end" className="tick">{t}</text></g>
          ))}
          <line x1={padL} x2={W - padR} y1={y(reserve)} y2={y(reserve)} className="thr thr-over" />
          <text x={padL + 4} y={y(reserve) - 5} className="thr-label over">reserve</text>
          <path d={area} className="soc-area" />
          <path d={line} className="soc-line" />
          {hours.map((h, i) => (
            <g key={h.timestamp} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} className="col">
              <rect x={x(i) - step / 2} y={padT} width={step} height={H - padT} className="hit" />
              {hover === i && <circle cx={x(i)} cy={y(h.soc_pct)} r={4.5} className="pt batt" />}
              {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" className="tick">{hh(h.timestamp)}</text>}
            </g>
          ))}
        </svg>
        {hover != null && hours[hover] && (
          <div className="tooltip" style={{ left: `${Math.min(82, Math.max(18, (x(hover) / W) * 100))}%` }} role="status">
            <b>{label(hours[hover].timestamp)}</b>
            <span>State of charge<em>{fmtNum(hours[hover].soc_pct, 1)}%</em></span>
            <span>{hours[hover].battery_kw >= 0 ? 'Discharging' : 'Charging'}<em>{fmtNum(Math.abs(hours[hover].battery_kw), 0)} kW</em></span>
            <span>Grid import<em>{fmtNum(hours[hover].grid_import_kw, 0)} kW</em></span>
          </div>
        )}
      </div>
    </figure>
  );
}
