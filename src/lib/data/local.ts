import { evidenceCanonical, newRef, sha256Hex } from '../hash';
import type { Activity, Claim, Company, EnergyRecord, Evidence, Facility, Role } from '../types';
import type { Membership, NewEvidence, Repo, User } from './repo';
import { buildDemo, DEMO_USER, type DemoDB } from './seed';

const KEY = 'ecocypher-esg-demo-v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const now = () => new Date().toISOString();

/** Demo backend: one sample company, stored in this browser only. Same interface as Supabase. */
export function createLocalRepo(): Repo {
  let db: DemoDB | null = null;
  let signedIn = true;
  const listeners = new Set<() => void>();

  async function load(): Promise<DemoDB> {
    if (db) return db;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) db = JSON.parse(raw) as DemoDB;
    } catch { /* ignore */ }
    if (!db) {
      db = await buildDemo();
      save();
    }
    return db;
  }
  function save() {
    try { if (db) localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full or blocked */ }
  }
  const files = new Map<string, string>(); // object URLs for files added this session

  const repo: Repo = {
    mode: 'demo',
    async currentUser(): Promise<User | null> { return signedIn ? DEMO_USER : null; },
    onAuthChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async signIn() { signedIn = true; listeners.forEach((l) => l()); },
    async signUp() { signedIn = true; listeners.forEach((l) => l()); return { needsConfirmation: false }; },
    async sendMagicLink() { /* demo */ },
    async signOut() { signedIn = false; listeners.forEach((l) => l()); },

    async memberships(): Promise<Membership[]> {
      const d = await load();
      return d.members.filter((m) => m.user_id === DEMO_USER.id).map((m) => ({ ...m, company: d.company }));
    },
    async myInvites() { return []; },
    async acceptInvite() { /* demo */ },
    async createCompany(): Promise<Company> { return (await load()).company; },
    async updateCompany(_id, patch) { const d = await load(); d.company = { ...d.company, ...patch }; save(); },
    async members() { return (await load()).members; },
    async invites() { return (await load()).invites; },
    async invite(company_id, email, role: Role) {
      const d = await load();
      d.invites.unshift({ id: uid(), company_id, email: email.toLowerCase(), role, created_at: now() });
      save();
    },
    async revokeInvite(id) { const d = await load(); d.invites = d.invites.filter((i) => i.id !== id); save(); },
    async setRole(_c, userId, role) { const d = await load(); d.members = d.members.map((m) => (m.user_id === userId ? { ...m, role } : m)); save(); },
    async removeMember(_c, userId) { const d = await load(); d.members = d.members.filter((m) => m.user_id !== userId); save(); },

    async facilities() { return (await load()).facilities; },
    async saveFacility(f) {
      const d = await load();
      const rec: Facility = { ...f, id: f.id ?? uid() } as Facility;
      d.facilities = f.id ? d.facilities.map((x) => (x.id === f.id ? rec : x)) : [...d.facilities, rec];
      save();
      return rec;
    },
    async deleteFacility(id) {
      const d = await load();
      d.facilities = d.facilities.filter((f) => f.id !== id);
      d.energy = d.energy.filter((e) => e.facility_id !== id);
      save();
    },
    async energy() { return (await load()).energy; },
    async saveEnergy(r) {
      const d = await load();
      const existing = d.energy.find((x) => x.id === r.id || (x.facility_id === r.facility_id && x.month === r.month));
      const rec: EnergyRecord = { ...r, id: existing?.id ?? uid(), created_at: existing?.created_at ?? now() } as EnergyRecord;
      d.energy = existing ? d.energy.map((x) => (x.id === existing.id ? rec : x)) : [...d.energy, rec];
      save();
      return rec;
    },
    async deleteEnergy(id) { const d = await load(); d.energy = d.energy.filter((e) => e.id !== id); save(); },

    async evidence() { return (await load()).evidence; },
    async addEvidence(input: NewEvidence) {
      const d = await load();
      const { file, ...rest } = input;
      let file_sha256 = rest.file_sha256 ?? null;
      let file_name = rest.file_name ?? null;
      let file_size = rest.file_size ?? null;
      let file_path: string | null = null;
      if (file) {
        file_sha256 = await sha256Hex(await file.arrayBuffer());
        file_name = file.name;
        file_size = file.size;
        file_path = `local/${uid()}`;
        files.set(file_path, URL.createObjectURL(file));
      }
      const ref = rest.ref ?? newRef();
      const base = { ...rest, ref, file_sha256, file_name, file_size };
      const canonical_json = rest.canonical_json ?? evidenceCanonical(base);
      const rec: Evidence = {
        ...base, id: uid(), canonical_json, sha256: rest.sha256 ?? (await sha256Hex(canonical_json)),
        file_path, created_by: DEMO_USER.name, created_at: now(),
      };
      d.evidence.unshift(rec);
      save();
      return rec;
    },
    async deleteEvidence(id) {
      const d = await load();
      d.evidence = d.evidence.filter((e) => e.id !== id);
      d.claims = d.claims.map((c) => ({ ...c, evidence_ids: c.evidence_ids.filter((x) => x !== id) }));
      save();
    },
    async fileUrl(path) { return files.get(path) ?? null; },

    async claims() { return (await load()).claims; },
    async saveClaim(c) {
      const d = await load();
      const existing = c.id ? d.claims.find((x) => x.id === c.id) : undefined;
      const rec: Claim = { ...c, id: c.id ?? uid(), created_at: existing?.created_at ?? now(), updated_at: now() } as Claim;
      d.claims = existing ? d.claims.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...d.claims];
      save();
      return rec;
    },
    async deleteClaim(id) { const d = await load(); d.claims = d.claims.filter((c) => c.id !== id); save(); },

    async activity(_c, limit = 30) { return (await load()).activity.slice(0, limit); },
    async log(a) {
      const d = await load();
      const rec: Activity = { ...a, id: uid(), actor: DEMO_USER.name, at: now() };
      d.activity = [rec, ...d.activity].slice(0, 300);
      save();
    },
  };
  return repo;
}

export function resetDemo() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
