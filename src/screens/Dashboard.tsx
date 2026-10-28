import { ArrowRight, Plus, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { StackedColumns } from '../components/charts';
import { ErrorNote, Loading, VerdictChip } from '../components/ui';
import { fyMonths, pctChange, prevFy, totals } from '../lib/emissions';
import { fmtNum, fmtPct } from '../lib/format';
import { useFinancialYears, useIntegrity, useLiveReports, useWorkspaceData } from '../lib/hooks';
import { href } from '../lib/router';
import { useCompany, useSession } from '../lib/session';

export function Dashboard() {
  const m = useCompany();
  const { can, user } = useSession();
  const { energy, evidence, claims } = useWorkspaceData();
  const years = useFinancialYears(energy.data);
  const [fyPick, setFy] = useState<string | undefined>();
  const fy = fyPick ?? years.defaultFy;
  const integrity = useIntegrity(evidence.data);
  const { reports } = useLiveReports();

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

  if (energy.loading || claims.loading || evidence.loading) return <Loading rows={3} />;

  const cl = claims.data ?? [];
  const verdictOf = (id: string) => reports[id]?.verdict;
  const waiting = cl.filter((c) => c.status === 'in_review' || c.status === 'draft');
  const atRisk = cl.filter((c) => c.status !== 'rejected' && verdictOf(c.id) === 'UNSUPPORTED');
  const altered = (evidence.data ?? []).filter((e) => integrity[e.id]?.state === 'TAMPERED').length;
  const n = stats?.now;
  const total = n ? n.scope1_t + n.scope2_t : 0;
  const change = stats ? pctChange(total, stats.before.scope1_t + stats.before.scope2_t) : null;
  const reShare = n && n.grid_kwh + n.renewable_kwh ? (n.renewable_kwh / (n.grid_kwh + n.renewable_kwh)) * 100 : null;
  const first = user?.name?.split(' ')[0];

  return (
    <>
      <header className="page-header">
        <div>
          <p className="muted">{greeting()}{first && first !== 'Demo' ? `, ${first}` : ''}</p>
          <h1 className="page-title">{m.company.name}</h1>
        </div>
        {years.all.length > 0 && (
          <select className="select quiet" aria-label="Financial year" value={fy} onChange={(e) => setFy(e.target.value)}>
            {years.all.map((y) => <option key={y} value={y}>FY {y}{years.complete.includes(y) ? '' : ' (so far)'}</option>)}
          </select>
        )}
      </header>
      <ErrorNote error={energy.error || claims.error || evidence.error} />

      {(altered > 0 || atRisk.length > 0) && (
        <a className="banner" href={href({ name: altered ? 'evidence' : 'claims' })}>
          <ShieldAlert size={18} aria-hidden />
          <span>
            {altered > 0 && <>{altered} evidence item{altered > 1 ? 's were' : ' was'} altered. </>}
            {atRisk.length > 0 && <>{atRisk.length} claim{atRisk.length > 1 ? 's are' : ' is'} not supported by evidence.</>}
          </span>
          <ArrowRight size={16} aria-hidden />
        </a>
      )}

      {n && n.records > 0 ? (
        <section className="overview">
          <div className="headline">
            <span className="label">Scope 1 + 2 emissions</span>
            <span className="big">{fmtNum(total, 0)}<small> tCO₂e</small></span>
            {change != null && <span className={`delta ${change < 0 ? 'good' : 'bad'}`}>{fmtPct(change, true)} vs FY {prevFy(fy!)}</span>}
          </div>
          <dl className="stats">
            <div><dt>Energy used</dt><dd>{fmtNum(n.total_gj, 0)} GJ</dd></div>
            <div><dt>Renewable electricity</dt><dd>{fmtPct(reShare)}</dd></div>
            <div><dt>Claims to review</dt><dd>{waiting.length}</dd></div>
          </dl>
        </section>
      ) : (
        <section className="card empty">
          <b>Start with your energy data</b>
          <p>Add monthly electricity and fuel use per facility. Emissions and reports are calculated from it.</p>
          {can('write') && <a className="btn btn-primary" href={href({ name: 'data' })}>Add energy data</a>}
        </section>
      )}

      {stats && stats.monthly.length > 0 && (
        <section className="card">
          <StackedColumns
            title="Emissions by month"
            unit="tCO₂e"
            data={stats.monthly}
            series={[
              { key: 's2', label: 'Scope 2', color: '#1F7A55', darkColor: '#3A9A70' },
              { key: 's1', label: 'Scope 1', color: '#C08A22', darkColor: '#B88A2E' },
            ]}
          />
        </section>
      )}

      <section className="stack">
        <div className="section-title">
          <h2>Claims waiting for you</h2>
          <a href={href({ name: 'claims' })}>All claims</a>
        </div>
        {waiting.length ? (
          <div className="rows">
            {waiting.slice(0, 4).map((c) => (
              <a key={c.id} className="row-link" href={href({ name: 'claim', id: c.id })}>
                <span className="clamp-2">{c.text}</span>
                <VerdictChip verdict={verdictOf(c.id)} />
              </a>
            ))}
          </div>
        ) : <p className="muted">You’re all caught up.</p>}
        {can('write') && (
          <a className="btn btn-ghost add" href={href({ name: 'claim', id: 'new' })}><Plus aria-hidden /> Check a new claim</a>
        )}
      </section>
    </>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
