import { AlertTriangle, ArrowRight, FilePlus2, FileSearch, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ShareBar, StackedColumns } from '../components/charts';
import { ErrorNote, Loading, PageHeader, StatusChip, VerdictChip } from '../components/ui';
import { fyMonths, pctChange, prevFy, totals } from '../lib/emissions';
import { fmtNum, fmtPct, relTime } from '../lib/format';
import { useFinancialYears, useIntegrity, useLiveReports, useWorkspaceData } from '../lib/hooks';
import { useQuery } from '../lib/query';
import { repo } from '../lib/data';
import { href } from '../lib/router';
import { useCompany, useSession } from '../lib/session';

export function Dashboard() {
  const m = useCompany();
  const { can } = useSession();
  const { energy, evidence, claims } = useWorkspaceData();
  const years = useFinancialYears(energy.data);
  const [fyPick, setFy] = useState<string | undefined>();
  const fy = fyPick ?? years.defaultFy;
  const integrity = useIntegrity(evidence.data);
  const { reports } = useLiveReports();
  const verdictOf = (id: string) => reports[id]?.verdict;
  const activity = useQuery(`${m.company_id}/activity`, () => repo.activity(m.company_id, 8));

  const stats = useMemo(() => {
    if (!energy.data || !fy) return null;
    const inFy = (f: string) => { const s = new Set(fyMonths(f)); return energy.data!.filter((r) => s.has(r.month)); };
    const now = totals(inFy(fy), m.company);
    const before = totals(inFy(prevFy(fy)), m.company);
    const monthly = fyMonths(fy).map((month) => {
      const t = totals(energy.data!.filter((r) => r.month === month), m.company);
      return { x: month, values: { s1: t.scope1_t, s2: t.scope2_t } };
    }).filter((d) => d.values.s1 + d.values.s2 > 0);
    return { now, before, monthly };
  }, [energy.data, fy, m.company]);

  if (energy.loading || claims.loading || evidence.loading) return <Loading rows={4} />;
  const err = energy.error || claims.error || evidence.error;

  const cl = claims.data ?? [];
  const open = cl.filter((c) => c.status === 'draft' || c.status === 'in_review');
  const risky = cl.filter((c) => c.status !== 'rejected' && verdictOf(c.id) === 'UNSUPPORTED');
  const publishedRisk = cl.filter((c) => (c.status === 'published' || c.status === 'approved') && verdictOf(c.id) === 'UNSUPPORTED');
  const tampered = (evidence.data ?? []).filter((e) => integrity[e.id]?.state === 'TAMPERED');
  const live = cl.filter((c) => c.status !== 'rejected' && verdictOf(c.id));
  const riskScore = live.length ? Math.round((live.filter((c) => verdictOf(c.id) !== 'SUPPORTED').length / live.length) * 100) : null;
  const n = stats?.now;
  const s12 = n ? n.scope1_t + n.scope2_t : 0;
  const s12b = stats ? stats.before.scope1_t + stats.before.scope2_t : 0;
  const reShare = n && n.grid_kwh + n.renewable_kwh ? (n.renewable_kwh / (n.grid_kwh + n.renewable_kwh)) * 100 : null;
  const turnover = fy ? m.company.turnover_cr?.[fy] : undefined;

  return (
    <>
      <PageHeader eyebrow={m.company.name} title="ESG overview" actions={
        years.all.length > 0 && (
          <label className="select-inline">
            <span className="sr-only">Financial year</span>
            <select className="select" value={fy} onChange={(e) => setFy(e.target.value)}>
              {years.all.map((y) => <option key={y} value={y}>FY {y}{years.complete.includes(y) ? '' : ' (partial)'}</option>)}
            </select>
          </label>
        )
      } />
      <ErrorNote error={err} />

      {(tampered.length > 0 || publishedRisk.length > 0) && (
        <div className="alerts">
          {tampered.length > 0 && (
            <a className="note fail row" href={href({ name: 'evidence' })}>
              <ShieldAlert size={18} aria-hidden />
              <span><b>{tampered.length} evidence item{tampered.length > 1 ? 's' : ''} altered after fingerprinting.</b> Claims relying on {tampered.length > 1 ? 'them' : 'it'} are not supported.</span>
              <ArrowRight size={16} aria-hidden />
            </a>
          )}
          {publishedRisk.length > 0 && (
            <a className="note warn row" href={href({ name: 'claims' })}>
              <AlertTriangle size={18} aria-hidden />
              <span><b>{publishedRisk.length} approved or published claim{publishedRisk.length > 1 ? 's' : ''}</b> fail the evidence check.</span>
              <ArrowRight size={16} aria-hidden />
            </a>
          )}
        </div>
      )}

      {n && n.records > 0 ? (
        <section className="kpis" aria-label={`Key figures for FY ${fy}`}>
          <div className="kpi hero-kpi">
            <small>Scope 1 + 2 emissions</small>
            <b>{fmtNum(s12, 0)}<span> tCO₂e</span></b>
            <em className={delta(pctChange(s12, s12b))}>{fmtPct(pctChange(s12, s12b), true)} vs FY {prevFy(fy!)}</em>
          </div>
          <div className="kpi"><small>Scope 1</small><b>{fmtNum(n.scope1_t, 0)}<span> t</span></b><em className={delta(pctChange(n.scope1_t, stats!.before.scope1_t))}>{fmtPct(pctChange(n.scope1_t, stats!.before.scope1_t), true)}</em></div>
          <div className="kpi"><small>Scope 2</small><b>{fmtNum(n.scope2_t, 0)}<span> t</span></b><em className={delta(pctChange(n.scope2_t, stats!.before.scope2_t))}>{fmtPct(pctChange(n.scope2_t, stats!.before.scope2_t), true)}</em></div>
          <div className="kpi"><small>Energy used</small><b>{fmtNum(n.total_gj, 0)}<span> GJ</span></b><em>{turnover ? `${fmtNum(n.total_gj / turnover, 1)} GJ per ₹ crore` : 'Add turnover for intensity'}</em></div>
          <div className="kpi"><small>Renewable electricity</small><b>{fmtPct(reShare)}</b><ShareBar value={reShare ?? 0} label="Renewable share" /></div>
        </section>
      ) : (
        <div className="card empty">
          <b>No energy data yet</b>
          <p>Add monthly electricity and fuel use per facility to calculate Scope 1 and 2 emissions.</p>
          {can('write') && <a className="btn btn-primary" href={href({ name: 'data' })}>Add energy data</a>}
        </div>
      )}

      {stats && stats.monthly.length > 0 && (
        <section className="card">
          <StackedColumns
            title={`Monthly emissions, FY ${fy}`}
            unit="tCO₂e"
            data={stats.monthly}
            series={[
              { key: 's2', label: 'Scope 2 (purchased electricity)', color: '#1F7A55', darkColor: '#3A9A70' },
              { key: 's1', label: 'Scope 1 (fuel)', color: '#C08A22', darkColor: '#B88A2E' },
            ]}
          />
          <p className="muted small">{n!.evidenced} of {n!.records} monthly records are linked to evidence. Factors: grid {m.company.grid_ef} kg/kWh, diesel {m.company.diesel_ef} kg/L, LPG {m.company.lpg_ef} kg/kg.</p>
        </section>
      )}

      <div className="grid-2">
        <section className="card stack">
          <div className="section-title"><h2>Claims pipeline</h2><a href={href({ name: 'claims' })}>Open register</a></div>
          <div className="pipeline">
            {(['draft', 'in_review', 'approved', 'published', 'rejected'] as const).map((s) => (
              <a key={s} href={href({ name: 'claims' }) + `?${s}`} onClick={(e) => { e.preventDefault(); sessionStorage.setItem('claims-filter', s); location.hash = href({ name: 'claims' }); }}>
                <b>{cl.filter((c) => c.status === s).length}</b><StatusChip status={s} />
              </a>
            ))}
          </div>
          <div className="risk">
            <div>
              <small className="muted">Greenwashing risk</small>
              <b>{riskScore == null ? '—' : `${riskScore}%`}</b>
              <small className="muted">of checked claims are not fully supported</small>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <span className="chip fail">{risky.length} not supported</span>
              <span className="chip info">{open.length} awaiting decision</span>
            </div>
          </div>
          {can('write') && (
            <div className="row">
              <a className="btn btn-primary" href={href({ name: 'claim', id: 'new' })}><FileSearch aria-hidden /> Check a new claim</a>
              <a className="btn btn-ghost" href={href({ name: 'evidence-new' })}><FilePlus2 aria-hidden /> Add evidence</a>
            </div>
          )}
        </section>

        <section className="card stack">
          <div className="section-title"><h2>Needs your attention</h2></div>
          {open.length === 0 ? <p className="muted">Nothing waiting. New claims will appear here.</p> : (
            <div className="list">
              {open.slice(0, 4).map((c) => (
                <a key={c.id} className="list-row" href={href({ name: 'claim', id: c.id })}>
                  <span className="clamp-2">{c.text}</span>
                  <span className="row" style={{ gap: 6 }}><StatusChip status={c.status} /><VerdictChip verdict={verdictOf(c.id)} /></span>
                </a>
              ))}
            </div>
          )}
          <div className="section-title" style={{ marginTop: 8 }}><h2>Recent activity</h2></div>
          <ul className="timeline">
            {(activity.data ?? []).slice(0, 5).map((a) => (
              <li key={a.id}><b>{a.actor}</b> {a.action}<small>{relTime(a.at)}</small></li>
            ))}
            {activity.data?.length === 0 && <li className="muted">No activity yet.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}

const delta = (p: number | null) => (p == null ? '' : p < 0 ? 'good' : p > 0 ? 'bad' : '');
