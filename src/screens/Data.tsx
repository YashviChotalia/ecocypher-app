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
  const fy = fyPick ?? years.all[0];
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

  return (
    <>
      <PageHeader title="Energy data" actions={write && (
        <>
          <label className="btn btn-ghost" style={{ cursor: 'pointer' }}><Upload aria-hidden /> Import<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { void importCsv(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <button className="btn btn-primary" onClick={openNew} disabled={!facilities.data?.length}><Plus aria-hidden /> Add month</button>
        </>
      )} />
      <ErrorNote error={facilities.error || energy.error} />

      <section className="stack">
        <div className="section-title"><h2>Facilities</h2>{write && <button className="link-btn" onClick={() => setFacDraft({})}><Plus size={16} aria-hidden /> Add facility</button>}</div>
        {facilities.data?.length ? (
          <div className="fac-grid">
            {facilities.data.map((f) => {
              const ft = totals((energy.data ?? []).filter((r) => r.facility_id === f.id && (!fy || fyMonths(fy).includes(r.month))), m.company);
              return (
                <button key={f.id} className={`fac ${fac === f.id ? 'active' : ''}`} onClick={() => setFac(fac === f.id ? 'all' : f.id)} aria-pressed={fac === f.id}>
                  <span className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <b>{f.name}</b>
                    {write && <span className="icon-sm" role="button" tabIndex={0} aria-label={`Edit ${f.name}`} onClick={(e) => { e.stopPropagation(); setFacDraft(f); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setFacDraft(f); } }}><Pencil size={14} aria-hidden /></span>}
                  </span>
                  <small>{f.city}{f.kind ? ` · ${f.kind}` : ''}</small>
                  <span className="fac-num">{fmtNum(ft.scope1_t + ft.scope2_t, 0)} tCO₂e <small>FY {fy ?? '—'}</small></span>
                </button>
              );
            })}
          </div>
        ) : (
          <Empty icon={<Building2 aria-hidden />} title="Add your first facility" action={write ? <button className="btn btn-primary" onClick={() => setFacDraft({})}>Add facility</button> : undefined}>
            Plants, offices and warehouses whose energy you report.
          </Empty>
        )}
      </section>

      {facilities.data?.length ? (
        <section className="card stack">
          <div className="toolbar">
            <label className="select-inline"><span className="sr-only">Financial year</span>
              <select className="select" value={fy} onChange={(e) => setFy(e.target.value)}>
                {years.all.map((y) => <option key={y} value={y}>FY {y}</option>)}
                {!years.all.length && <option>No data yet</option>}
              </select>
            </label>
            <label className="select-inline"><span className="sr-only">Facility</span>
              <select className="select" value={fac} onChange={(e) => setFac(e.target.value)}>
                <option value="all">All facilities</option>
                {facilities.data.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <button className="link-btn" onClick={() => download('energy-template.csv', toCsv([['facility', 'month', 'grid_kwh', 'renewable_kwh', 'diesel_l', 'lpg_kg'], [facilities.data![0].name, '2026-09', 410000, 0, 2400, 0]]))}>CSV template</button>
          </div>
          <div className="summary-strip">
            <span><small>Grid electricity</small><b>{fmtNum(t.grid_kwh, 0)} kWh</b></span>
            <span><small>Renewable</small><b>{fmtNum(t.renewable_kwh, 0)} kWh</b></span>
            <span><small>Scope 1</small><b>{fmtNum(t.scope1_t, 1)} t</b></span>
            <span><small>Scope 2</small><b>{fmtNum(t.scope2_t, 1)} t</b></span>
          </div>
          {rows.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Month</th><th>Facility</th><th className="num">Grid kWh</th><th className="num">Renewable kWh</th><th className="num">Diesel L</th><th className="num">LPG kg</th><th>Evidence</th>{write && <th><span className="sr-only">Edit</span></th>}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{fmtMonth(r.month)}</td><td>{facName(r.facility_id)}</td>
                      <td className="num">{fmtNum(r.grid_kwh, 0)}</td><td className="num">{fmtNum(r.renewable_kwh, 0)}</td>
                      <td className="num">{fmtNum(r.diesel_l, 0)}</td><td className="num">{fmtNum(r.lpg_kg, 0)}</td>
                      <td>{r.evidence_id ? <span className="chip pass">Linked</span> : <span className="chip neutral">None</span>}</td>
                      {write && <td><button className="icon-btn sm" onClick={() => openEdit(r)} aria-label={`Edit ${facName(r.facility_id)} ${fmtMonth(r.month)}`}><Pencil aria-hidden /></button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">No records for this selection.</p>}
        </section>
      ) : null}

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
