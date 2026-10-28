import { FileDown, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CHANNEL_LABEL, KIND_LABEL, Loading, PageHeader, StatusChip, VerdictChip, download, toCsv } from '../components/ui';
import { FACTOR_SOURCES, fyMonths, prevFy, totals, type Totals } from '../lib/emissions';
import { fmtDate, fmtNum } from '../lib/format';
import { useFinancialYears, useIntegrity, useLiveReports, useWorkspaceData } from '../lib/hooks';
import { shortHash } from '../lib/hash';
import { useCompany } from '../lib/session';

export function Reports() {
  const m = useCompany();
  const { energy, evidence, claims } = useWorkspaceData();
  const years = useFinancialYears(energy.data);
  const [fyPick, setFy] = useState<string>();
  const fy = fyPick ?? years.defaultFy;
  const integrity = useIntegrity(evidence.data);
  const { reports } = useLiveReports();

  const data = useMemo(() => {
    if (!energy.data || !fy) return null;
    const pick = (f: string) => { const s = new Set(fyMonths(f)); return totals(energy.data!.filter((r) => s.has(r.month)), m.company); };
    return { now: pick(fy), prev: pick(prevFy(fy)) };
  }, [energy.data, fy, m.company]);

  if (energy.loading || evidence.loading || claims.loading) return <Loading />;
  if (!fy || !data) return <div className="card empty"><b>No data to report yet</b><p>Add energy records on the Data page first.</p></div>;

  const tNow = m.company.turnover_cr?.[fy];
  const tPrev = m.company.turnover_cr?.[prevFy(fy)];
  const rows = brsrRows(data.now, data.prev, tNow, tPrev);
  const fyClaims = (claims.data ?? []).filter((c) => c.status === 'approved' || c.status === 'published');
  const ev = evidence.data ?? [];
  const intact = ev.filter((e) => integrity[e.id]?.state === 'INTACT').length;
  const altered = ev.filter((e) => integrity[e.id]?.state === 'TAMPERED');

  const exportCsv = () => download(`BRSR-P6-FY${fy}.csv`, toCsv([
    ['Parameter', `FY ${fy}`, `FY ${prevFy(fy)}`, 'Unit'],
    ...rows.map((r) => [r.label, r.now == null ? '' : r.now.toFixed(2), r.prev == null ? '' : r.prev.toFixed(2), r.unit]),
  ]));
  const exportJson = () => download(`ecocypher-esg-FY${fy}.json`, JSON.stringify({
    company: { name: m.company.name, cin: m.company.cin, industry: m.company.industry }, financial_year: fy,
    factors: { grid_ef: m.company.grid_ef, diesel_ef: m.company.diesel_ef, lpg_ef: m.company.lpg_ef, sources: FACTOR_SOURCES },
    brsr_principle_6: rows, claims: fyClaims.map((c) => ({ text: c.text, channel: c.channel, status: c.status, verdict: reports[c.id]?.verdict, score: reports[c.id]?.score, evidence: c.evidence_ids })),
    evidence: ev.map((e) => ({ ref: e.ref, title: e.title, kind: e.kind, sha256: e.sha256, integrity: integrity[e.id]?.state, anchor_status: e.anchor_status, audited: e.audited })),
    generated_at: new Date().toISOString(),
  }, null, 2), 'application/json');

  return (
    <>
      <PageHeader title="Reports" actions={<>
        <label className="select-inline"><span className="sr-only">Financial year</span>
          <select className="select quiet" value={fy} onChange={(e) => setFy(e.target.value)}>{years.all.map((y) => <option key={y} value={y}>FY {y}</option>)}</select>
        </label>
        <button className="btn btn-primary" onClick={() => window.print()}><Printer aria-hidden /> Save as PDF</button>
      </>} />

      <p className="muted small row" style={{ gap: 14 }}>Also download as <button className="link-btn" onClick={exportCsv}><FileDown size={15} aria-hidden /> CSV</button><button className="link-btn" onClick={exportJson}><FileDown size={15} aria-hidden /> JSON</button></p>
      <article className="report-doc">
        <header className="report-head">
          <div>
            <span className="eyebrow">ESG disclosure extract · FY {fy}</span>
            <h2>{m.company.name}</h2>
            <p className="muted small">{m.company.industry}{m.company.cin ? ` · CIN ${m.company.cin}` : ''} · Generated {fmtDate(new Date().toISOString())} with EcoCypher</p>
          </div>
          <img src="/logo.svg" alt="" width={48} height={48} />
        </header>

        <section className="stack">
          <h3>BRSR Section C, Principle 6: energy and emissions</h3>
          {data.now.records < 12 * 1 && <p className="note warn small">FY {fy} has only {data.now.records} monthly records. Figures are partial.</p>}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Parameter</th><th className="num">FY {fy}</th><th className="num">FY {prevFy(fy)}</th><th>Unit</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className={r.strong ? 'strong' : ''}><td>{r.label}</td><td className="num">{r.now == null ? '—' : fmtNum(r.now, r.digits ?? 0)}</td><td className="num">{r.prev == null ? '—' : fmtNum(r.prev, r.digits ?? 0)}</td><td>{r.unit}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Energy content: electricity 0.0036 GJ/kWh; diesel 0.0358 GJ/L; LPG 0.0473 GJ/kg (IPCC 2006). Emission factors: grid {m.company.grid_ef} kg CO₂e/kWh ({FACTOR_SOURCES.grid_ef}); diesel {m.company.diesel_ef} kg/L; LPG {m.company.lpg_ef} kg/kg.
            {' '}{data.now.evidenced} of {data.now.records} monthly records are linked to evidence.
          </p>
        </section>

        <section className="stack">
          <h3>Environmental claims approved for publication</h3>
          {fyClaims.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Claim</th><th>Channel</th><th>Status</th><th>Evidence check</th></tr></thead>
                <tbody>{fyClaims.map((c) => (
                  <tr key={c.id}><td style={{ minWidth: 240 }}>{c.text}</td><td>{CHANNEL_LABEL[c.channel]}</td><td><StatusChip status={c.status} /></td><td><VerdictChip verdict={reports[c.id]?.verdict} /></td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="muted small">No approved claims.</p>}
        </section>

        <section className="stack">
          <h3>Evidence index</h3>
          <p className="small">{ev.length} items · {intact} intact · {altered.length} altered{altered.length ? ` (${altered.map((e) => e.ref).join(', ')})` : ''}</p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>ID</th><th>Evidence</th><th>Type</th><th>SHA-256</th><th>Integrity</th></tr></thead>
              <tbody>{ev.map((e) => (
                <tr key={e.id}><td className="mono">{e.ref}</td><td>{e.title}</td><td>{KIND_LABEL[e.kind]}</td><td className="mono">{shortHash(e.sha256, 8)}</td>
                  <td>{integrity[e.id]?.state === 'TAMPERED' ? <span className="chip fail">Altered</span> : integrity[e.id] ? <span className="chip pass">{e.anchor_status === 'ANCHORED' ? 'Intact, anchored' : 'Intact'}</span> : '…'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      </article>
    </>
  );
}

interface Row { label: string; now: number | null; prev: number | null; unit: string; strong?: boolean; digits?: number }
function brsrRows(a: Totals, b: Totals, tNow?: number, tPrev?: number): Row[] {
  const v = (t: Totals, x: number) => (t.records ? x : null);
  const per = (x: number | null, t?: number) => (x == null || !t ? null : x / t);
  const nonRenewElec = (t: Totals) => t.grid_kwh * 0.0036;
  return [
    { label: 'From renewable sources: electricity consumption (A)', now: v(a, a.renewable_gj), prev: v(b, b.renewable_gj), unit: 'GJ' },
    { label: 'From renewable sources: fuel consumption (B)', now: v(a, 0), prev: v(b, 0), unit: 'GJ' },
    { label: 'Total energy from renewable sources (A+B)', now: v(a, a.renewable_gj), prev: v(b, b.renewable_gj), unit: 'GJ', strong: true },
    { label: 'From non-renewable sources: electricity consumption (D)', now: v(a, nonRenewElec(a)), prev: v(b, nonRenewElec(b)), unit: 'GJ' },
    { label: 'From non-renewable sources: fuel consumption (E)', now: v(a, a.fuel_gj), prev: v(b, b.fuel_gj), unit: 'GJ' },
    { label: 'Total energy from non-renewable sources (D+E)', now: v(a, nonRenewElec(a) + a.fuel_gj), prev: v(b, nonRenewElec(b) + b.fuel_gj), unit: 'GJ', strong: true },
    { label: 'Total energy consumed', now: v(a, a.total_gj), prev: v(b, b.total_gj), unit: 'GJ', strong: true },
    { label: 'Energy intensity per rupee of turnover', now: per(v(a, a.total_gj), tNow), prev: per(v(b, b.total_gj), tPrev), unit: 'GJ per ₹ crore', digits: 2 },
    { label: 'Total Scope 1 emissions', now: v(a, a.scope1_t), prev: v(b, b.scope1_t), unit: 'tCO₂e', digits: 1 },
    { label: 'Total Scope 2 emissions', now: v(a, a.scope2_t), prev: v(b, b.scope2_t), unit: 'tCO₂e', digits: 1 },
    { label: 'Total Scope 1 + 2 emissions', now: v(a, a.scope1_t + a.scope2_t), prev: v(b, b.scope1_t + b.scope2_t), unit: 'tCO₂e', strong: true, digits: 1 },
    { label: 'Scope 1 + 2 emission intensity per rupee of turnover', now: per(v(a, a.scope1_t + a.scope2_t), tNow), prev: per(v(b, b.scope1_t + b.scope2_t), tPrev), unit: 'tCO₂e per ₹ crore', digits: 2 },
  ];
}
