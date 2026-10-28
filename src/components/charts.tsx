import { useId, useState } from 'react';
import { fmtCompact, fmtMonth, fmtNum } from '../lib/format';

export interface Series { key: string; label: string; color: string; darkColor: string }

/**
 * Stacked columns with a shared baseline: 2px surface gaps between segments,
 * 4px rounded top on the stack only, hover tooltip, legend, and a table view.
 */
export function StackedColumns({ data, series, unit, title }: {
  data: { x: string; values: Record<string, number> }[];
  series: Series[];
  unit: string;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const W = 640, H = 240, padL = 44, padR = 8, padT = 12, padB = 28;
  const max = Math.max(1, ...data.map((d) => series.reduce((a, s) => a + (d.values[s.key] ?? 0), 0)));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const band = (W - padL - padR) / Math.max(1, data.length);
  const bw = Math.min(24, band * 0.62);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  return (
    <figure className="chart" aria-labelledby={`${id}-t`}>
      <figcaption className="chart-head">
        <span id={`${id}-t`} className="chart-title">{title}</span>
        <span className="legend">
          {series.map((s) => <span key={s.key}><i style={{ ['--c' as string]: s.color, ['--cd' as string]: s.darkColor }} />{s.label}</span>)}
        </span>
        <button className="link-btn" onClick={() => setTable((t) => !t)} aria-pressed={table}>{table ? 'Chart' : 'Table'}</button>
      </figcaption>
      {table ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Month</th>{series.map((s) => <th key={s.key} className="num">{s.label}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>{data.map((d) => (
              <tr key={d.x}><td>{fmtMonth(d.x)}</td>{series.map((s) => <td key={s.key} className="num">{fmtNum(d.values[s.key] ?? 0)}</td>)}
                <td className="num">{fmtNum(series.reduce((a, s) => a + (d.values[s.key] ?? 0), 0))}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="chart-plot" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, ${unit}`} preserveAspectRatio="none">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="grid" />
                <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="tick">{fmtCompact(t)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = padL + band * i + band / 2;
              let acc = 0;
              const segs = series.map((s) => {
                const v = d.values[s.key] ?? 0;
                const y0 = y(acc), y1 = y(acc + v);
                acc += v;
                return { s, y0, y1, v };
              }).filter((g) => g.v > 0);
              return (
                <g key={d.x} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} className="col">
                  <rect x={padL + band * i} y={padT} width={band} height={H - padT - padB} className="hit" />
                  {segs.map((g, j) => {
                    const isTop = j === segs.length - 1;
                    const h = Math.max(0, g.y0 - g.y1 - (j > 0 ? 2 : 0));
                    const r = isTop ? Math.min(4, h) : 0;
                    const x0 = cx - bw / 2, yTop = g.y1, yBot = g.y1 + h;
                    const dPath = `M${x0},${yBot} L${x0},${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} L${x0 + bw - r},${yTop} Q${x0 + bw},${yTop} ${x0 + bw},${yTop + r} L${x0 + bw},${yBot} Z`;
                    return <path key={g.s.key} d={dPath} className="seg" style={{ ['--c' as string]: g.s.color, ['--cd' as string]: g.s.darkColor }} opacity={hover == null || hover === i ? 1 : 0.45} />;
                  })}
                  {(i % (data.length > 8 ? 2 : 1) === 0) && <text x={cx} y={H - 8} textAnchor="middle" className="tick">{fmtMonth(d.x).split(' ')[0]}</text>}
                </g>
              );
            })}
          </svg>
          {hover != null && data[hover] && (
            <div className="tooltip" style={{ left: `${((padL + band * hover + band / 2) / W) * 100}%` }} role="status">
              <b>{fmtMonth(data[hover].x)}</b>
              {series.map((s) => (
                <span key={s.key}><i style={{ ['--c' as string]: s.color, ['--cd' as string]: s.darkColor }} />{s.label}<em>{fmtNum(data[hover].values[s.key] ?? 0)} {unit}</em></span>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Horizontal share bar for a single proportion (e.g. renewable share). */
export function ShareBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="sharebar" role="img" aria-label={`${label}: ${v.toFixed(1)}%`}>
      <span style={{ width: `${v}%` }} />
    </div>
  );
}
