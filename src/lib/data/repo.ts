import type { Activity, Claim, Company, EnergyRecord, Evidence, Facility, Invite, Member, Role } from '../types';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Membership extends Member {
  company: Company;
}

export type NewEvidence = Omit<Evidence, 'id' | 'created_at' | 'sha256' | 'canonical_json' | 'ref' | 'file_path'> & {
  ref?: string;
  /** For imported MRV records: the canonical JSON and hash they were issued with. */
  canonical_json?: string;
  sha256?: string;
  file?: File | null;
};

/** Everything the UI needs from a backend. Implemented by the demo (local) and Supabase adapters. */
export interface Repo {
  mode: 'demo' | 'supabase';
  // auth
  currentUser(): Promise<User | null>;
  onAuthChange(cb: () => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, name: string): Promise<{ needsConfirmation: boolean }>;
  sendMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;
  // tenancy
  memberships(): Promise<Membership[]>;
  myInvites(): Promise<Invite[]>;
  acceptInvite(id: string): Promise<void>;
  createCompany(input: Pick<Company, 'name' | 'industry' | 'cin'>): Promise<Company>;
  updateCompany(id: string, patch: Partial<Company>): Promise<void>;
  members(companyId: string): Promise<Member[]>;
  invites(companyId: string): Promise<Invite[]>;
  invite(companyId: string, email: string, role: Role): Promise<void>;
  revokeInvite(id: string): Promise<void>;
  setRole(companyId: string, userId: string, role: Role): Promise<void>;
  removeMember(companyId: string, userId: string): Promise<void>;
  // facilities & energy
  facilities(companyId: string): Promise<Facility[]>;
  saveFacility(f: Omit<Facility, 'id'> & { id?: string }): Promise<Facility>;
  deleteFacility(id: string): Promise<void>;
  energy(companyId: string): Promise<EnergyRecord[]>;
  saveEnergy(r: Omit<EnergyRecord, 'id' | 'created_at'> & { id?: string }): Promise<EnergyRecord>;
  deleteEnergy(id: string): Promise<void>;
  // evidence
  evidence(companyId: string): Promise<Evidence[]>;
  addEvidence(input: NewEvidence): Promise<Evidence>;
  deleteEvidence(id: string): Promise<void>;
  fileUrl(path: string): Promise<string | null>;
  // claims
  claims(companyId: string): Promise<Claim[]>;
  saveClaim(c: Omit<Claim, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<Claim>;
  deleteClaim(id: string): Promise<void>;
  // audit trail
  activity(companyId: string, limit?: number): Promise<Activity[]>;
  log(a: Omit<Activity, 'id' | 'at' | 'actor'>): Promise<void>;
}
