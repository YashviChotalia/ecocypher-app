import { Building2, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Empty, ErrorNote, Loading, PageHeader, Sheet, download, toCsv, toast } from '../components/ui';
import { repo } from '../lib/data';
import { fyMonths, totals } from '../lib/emissions';
import { fmtMonth, fmtNum } from '../lib/format';
import { refresh, useFinancialYears, useWorkspaceData } from '../lib/hooks';
import { useCompany, useSession } from '../lib/session';
import type { EnergyRecord, Facility } from '../lib/types';

type Draft = { id?: string; facility_id: string; month: string; grid_kwh: string; renewable_kwh: string; diesel_l: string; lpg_kg: string; evidence_id: string };

export function Data() {
  const m = useCompany();
  const { can } = useSession();
  const { facilities, energy, evidence } = useWorkspaceData();
  const years = useFinancialYears(energy.data);
  const [fyPick, setFy] = useState<string>();
  const fy = fyPick ?? years.defaultFy;
  const [fac, setFac] = useState<string>('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [facDraft, setFacDraft] = useState<Partial<Facility> | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    if (!energy.data) return [];
    const months = fy ? new Set(fyMonths(fy)) : null;
    return energy.data.filter((r) => (!months || months.has(r.month)) && (fac === 'all' || r.facility_id === fac))
      .sort((a, b) => b.month.localeCompare(a.month) || a.facility_id.localeCompare(b.facility_id));
  }, [energy.data, fy, fac]);
  const t = totals(rows, m.company);
  const facName = (id: string) => facilities.data?.find((f) => f.id === id)?.name ?? '—';

  const openNew = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    setDraft({ facility_id: fac !== 'all' ? fac : facilities.data?.[0]?.id ?? '', month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, grid_kwh: '', renewable_kwh: '0', diesel_l: '0', lpg_kg: '0', evidence_id: '' });
  };
  const openEdit = (r: EnergyRecord) => setDraft({ id: r.id, facility_id: r.facility_id, month: r.month, grid_kwh: String(r.grid_kwh), renewable_kwh: String(r.renewable_kwh), diesel_l: String(r.diesel_l), lpg_kg: String(r.lpg_kg), evidence_id: r.evidence_id ?? '' });
  const n = (v: string) => Math.max(0, Number(v.replace(/,/g, '')) || 0);

  const saveRecord = async () => {
    if (!draft || !draft.facility_id || !/^\d{4}-\d{2}$/.test(draft.month)) return;
    setBusy(true);
    try {
      await repo.saveEnergy({ id: draft.id, company_id: m.company_id, facility_id: draft.facility_id, month: draft.month, grid_kwh: n(draft.grid_kwh), renewable_kwh: n(draft.renewable_kwh), diesel_l: n(draft.diesel_l), lpg_kg: n(draft.lpg_kg), evidence_id: draft.evidence_id || null });
      await repo.log({ company_id: m.company_id, action: draft.id ? 'updated energy data' : 'added energy data', entity: 'energy', detail: `${facName(draft.facility_id)}, ${fmtMonth(draft.month)}` });
      refresh(m.company_id, 'energy'); refresh(m.company_id, 'activity');
      setDraft(null);
      toast('Saved');
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const removeRecord = async () => {
    if (!draft?.id) return;
    setBusy(true);
    try { await repo.deleteEnergy(draft.id); refresh(m.company_id, 'energy'); setDraft(null); toast('Deleted'); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  const saveFacility = async () => {
    if (!facDraft?.name?.trim()) return;
    setBusy(true);
    try {
      await repo.saveFacility({ id: facDraft.id, company_id: m.company_id, name: facDraft.name.trim(), city: facDraft.city ?? '', kind: facDraft.kind ?? '' });
      await repo.log({ company_id: m.company_id, action: facDraft.id ? 'updated a facility' : 'added a facility', entity: 'facility', detail: facDraft.name });
      refresh(m.company_id, 'facilities');
      setFacDraft(null);
      toast('Facility saved');
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const deleteFacility = async () => {
    if (!facDraft?.id) return;
    setBusy(true);
    try { await repo.deleteFacility(facDraft.id); refresh(m.company_id, 'facilities'); refresh(m.company_id, 'energy'); setFacDraft(null); toast('Facility deleted'); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  const importCsv = async (file?: File) => {
    if (!file || !facilities.data) return;
    const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim());
    const head = lines.shift()?.toLowerCase().split(',').map((s) => s.trim()) ?? [];
    const col = (k: string) => head.indexOf(k);
    if (col('facility') < 0 || col('month') < 0) { toast('CSV needs facility and month columns. Download the template.'); return; }
    let ok = 0, skipped = 0;
    setBusy(true);
    for (const line of lines) {
      const c = line.split(',').map((s) => s.trim());
      const f = facilities.data.find((x) => x.name.toLowerCase() === c[col('facility')]?.toLowerCase() || x.id === c[col('facility')]);
      const month = c[col('month')];
      if (!f || !/^\d{4}-\d{2}$/.test(month)) { skipped++; continue; }
      const val = (k: string) => (col(k) >= 0 ? n(c[col(k)] ?? '0') : 0);
      try {
        await repo.saveEnergy({ company_id: m.company_id, facility_id: f.id, month, grid_kwh: val('grid_kwh'), renewable_kwh: val('renewable_kwh'), diesel_l: val('diesel_l'), lpg_kg: val('lpg_kg'), evidence_id: null });
        ok++;
      } catch { skipped++; }
    }
    await repo.log({ company_id: m.company_id, action: `imported ${ok} energy records`, entity: 'energy', detail: file.name });
    refresh(m.company_id, 'energy'); refresh(m.company_id, 'activity');
    setBusy(false);
    toast(`Imported ${ok} rows${skipped ? `, skipped ${skipped}` : ''}`);
  };

  if (facilities.loading || energy.loading) return <Loading />;
  const write = can('write');

  const months = [...new Set(rows.map((r) => r.month))].sort().reverse();
  const template = () => download('energy-template.csv', toCsv([['facility', 'month', 'grid_kwh', 'renewable_kwh', 'diesel_l', 'lpg_kg'], [facilities.data?.[0]?.name ?? 'Plant A', '2026-09', 410000, 0, 2400, 0]]));

  return (
    <>
      <PageHeader title="Energy" actions={write && facilities.data?.length ? (
        <button className="btn btn-primary" onClick={openNew}><Plus aria-hidden /> Add month</button>
      ) : undefined} />
      <ErrorNote error={facilities.error || energy.error} />

      {!facilities.data?.length ? (
        <Empty icon={<Building2 aria-hidden />} title="Add your first facility" action={write ? <button className="btn btn-primary" onClick={() => setFacDraft({})}>Add facility</button> : undefined}>
          Plants, offices and warehouses whose energy you report.
        </Empty>
      ) : (
        <>
          <div className="filters">
            <select className="select quiet" aria-label="Financial year" value={fy} onChange={(e) => setFy(e.target.value)}>
              {years.all.map((y) => <option key={y} value={y}>FY {y}</option>)}
              {!years.all.length && <option>No data yet</option>}
            </select>
            <select className="select quiet" aria-label="Facility" value={fac} onChange={(e) => setFac(e.target.value)}>
              <option value="all">All facilities</option>
              {facilities.data.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>

          <dl className="stats four">
            <div><dt>Grid electricity</dt><dd>{fmtNum(t.grid_kwh, 0)} <small>kWh</small></dd></div>
            <div><dt>Renewable</dt><dd>{fmtNum(t.renewable_kwh, 0)} <small>kWh</small></dd></div>
            <div><dt>Scope 1</dt><dd>{fmtNum(t.scope1_t, 1)} <small>t</small></dd></div>
            <div><dt>Scope 2</dt><dd>{fmtNum(t.scope2_t, 1)} <small>t</small></dd></div>
          </dl>

          <section className="stack">
            <h2 className="h2">By month</h2>
            {months.length ? (
              <div className="rows">
                {months.map((mo, i) => {
                  const recs = rows.filter((r) => r.month === mo);
                  const mt = totals(recs, m.company);
                  return (
                    <details key={mo} className="month" open={i === 0}>
                      <summary>
                        <span className="row-main">
                          <b>{fmtMonth(mo)}</b>
                          <small>{fmtNum(mt.grid_kwh + mt.renewable_kwh, 0)} kWh electricity{mt.renewable_kwh ? ` · ${fmtNum((mt.renewable_kwh / (mt.grid_kwh + mt.renewable_kwh)) * 100, 0)}% renewable` : ''}</small>
                        </span>
                        <span className="month-total">{fmtNum(mt.scope1_t + mt.scope2_t, 1)} <small>tCO₂e</small></span>
                      </summary>
                      <ul className="entries">
                        {recs.map((r) => (
                          <li key={r.id}>
                            <div className="entry-head">
                              <span className="row-main">
                                <b>{facName(r.facility_id)}</b>
                                {r.evidence_id ? <span className="tag pass">Evidence linked</span> : <span className="tag neutral">No evidence</span>}
                              </span>
                              {write && <button className="icon-btn sm" onClick={() => openEdit(r)} aria-label={`Edit ${facName(r.facility_id)} ${fmtMonth(r.month)}`}><Pencil aria-hidden /></button>}
                            </div>
                            <dl className="entry-vals">
                              <div><dt>Grid</dt><dd>{fmtNum(r.grid_kwh, 0)} kWh</dd></div>
                              <div><dt>Renewable</dt><dd>{fmtNum(r.renewable_kwh, 0)} kWh</dd></div>
                              <div><dt>Diesel</dt><dd>{fmtNum(r.diesel_l, 0)} L</dd></div>
                              <div><dt>LPG</dt><dd>{fmtNum(r.lpg_kg, 0)} kg</dd></div>
                            </dl>
                          </li>
                        ))}
                      </ul>
                    </details>
                  );
                })}
              </div>
            ) : <p className="muted">No records for this selection.</p>}
          </section>

          <section className="stack">
            <div className="section-title"><h2>Facilities</h2>{write && <button className="link-btn" onClick={() => setFacDraft({})}><Plus size={16} aria-hidden /> Add</button>}</div>
            <div className="rows">
              {facilities.data.map((f) => {
                const ft = totals((energy.data ?? []).filter((r) => r.facility_id === f.id && (!fy || fyMonths(fy).includes(r.month))), m.company);
                return (
                  <div key={f.id} className="row-link">
                    <span className="row-main"><b>{f.name}</b><small>{f.city}{f.kind ? ` · ${f.kind}` : ''}</small></span>
                    <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                      <span className="month-total">{fmtNum(ft.scope1_t + ft.scope2_t, 0)} <small>t</small></span>
                      {write && <button className="icon-btn sm" onClick={() => setFacDraft(f)} aria-label={`Edit ${f.name}`}><Pencil aria-hidden /></button>}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {write && (
            <p className="muted small row" style={{ gap: 14 }}>
              <label className="link-btn" style={{ cursor: 'pointer' }}><Upload size={15} aria-hidden /> Import CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { void importCsv(e.target.files?.[0]); e.target.value = ''; }} /></label>
              <button className="link-btn quiet-link" onClick={template}>Download template</button>
            </p>
          )}
        </>
      )}

      <Sheet title={draft?.id ? 'Edit month' : 'Add a month of data'} open={!!draft} onClose={() => setDraft(null)} footer={<>
        {draft?.id && <button className="btn btn-ghost danger-text" onClick={() => void removeRecord()} disabled={busy}><Trash2 aria-hidden /> Delete</button>}
        <button className="btn btn-primary" onClick={() => void saveRecord()} disabled={busy || !draft?.facility_id}>Save</button>
      </>}>
        {draft && (
          <div className="form-grid">
            <label className="field">Facility<select className="select" value={draft.facility_id} onChange={(e) => setDraft({ ...draft, facility_id: e.target.value })}>{facilities.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
            <label className="field">Month<input type="month" className="input" value={draft.month} onChange={(e) => setDraft({ ...draft, month: e.target.value })} /></label>
            <label className="field">Grid electricity (kWh)<input className="input" inputMode="decimal" value={draft.grid_kwh} onChange={(e) => setDraft({ ...draft, grid_kwh: e.target.value })} /></label>
            <label className="field">Renewable electricity (kWh)<input className="input" inputMode="decimal" value={draft.renewable_kwh} onChange={(e) => setDraft({ ...draft, renewable_kwh: e.target.value })} /></label>
            <label className="field">Diesel (litres)<input className="input" inputMode="decimal" value={draft.diesel_l} onChange={(e) => setDraft({ ...draft, diesel_l: e.target.value })} /></label>
            <label className="field">LPG (kg)<input className="input" inputMode="decimal" value={draft.lpg_kg} onChange={(e) => setDraft({ ...draft, lpg_kg: e.target.value })} /></label>
            <label className="field wide">Supporting evidence<select className="select" value={draft.evidence_id} onChange={(e) => setDraft({ ...draft, evidence_id: e.target.value })}><option value="">None</option>{evidence.data?.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
          </div>
        )}
      </Sheet>

      <Sheet title={facDraft?.id ? 'Edit facility' : 'Add facility'} open={!!facDraft} onClose={() => setFacDraft(null)} footer={<>
        {facDraft?.id && <button className="btn btn-ghost danger-text" onClick={() => void deleteFacility()} disabled={busy}><Trash2 aria-hidden /> Delete</button>}
        <button className="btn btn-primary" onClick={() => void saveFacility()} disabled={busy || !facDraft?.name?.trim()}>Save</button>
      </>}>
        {facDraft && (
          <div className="form-grid">
            <label className="field wide">Name<input className="input" value={facDraft.name ?? ''} onChange={(e) => setFacDraft({ ...facDraft, name: e.target.value })} placeholder="e.g. Pune assembly plant" /></label>
            <label className="field">City & state<input className="input" value={facDraft.city ?? ''} onChange={(e) => setFacDraft({ ...facDraft, city: e.target.value })} /></label>
            <label className="field">Type<input className="input" value={facDraft.kind ?? ''} onChange={(e) => setFacDraft({ ...facDraft, kind: e.target.value })} placeholder="Manufacturing, office…" /></label>
            {facDraft.id && <p className="muted small wide">Deleting a facility also deletes its energy records.</p>}
          </div>
        )}
      </Sheet>
    </>
  );
}
