export type Role = 'admin' | 'manager' | 'viewer';

export interface Company {
  id: string;
  name: string;
  industry: string;
  cin?: string;
  /** Grid emission factor, kg CO₂e per kWh (default: CEA CO₂ Baseline Database). */
  grid_ef: number;
  diesel_ef: number; // kg CO₂e per litre
  lpg_ef: number; // kg CO₂e per kg
  /** Turnover by financial year, ₹ crore, e.g. { "2025-26": 412 } */
  turnover_cr: Record<string, number>;
  created_at: string;
}

export interface Member {
  user_id: string;
  company_id: string;
  role: Role;
  name: string;
  email: string;
}

export interface Invite {
  id: string;
  company_id: string;
  company_name?: string;
  email: string;
  role: Role;
  created_at: string;
}

export interface Facility {
  id: string;
  company_id: string;
  name: string;
  city: string;
  kind: string;
}

/** One month of activity data for one facility. */
export interface EnergyRecord {
  id: string;
  company_id: string;
  facility_id: string;
  month: string; // YYYY-MM
  grid_kwh: number;
  renewable_kwh: number;
  diesel_l: number;
  lpg_kg: number;
  evidence_id?: string | null;
  created_at: string;
}

export type EvidenceKind = 'mrv' | 'meter' | 'invoice' | 'audit' | 'certificate' | 'other';
export type AnchorStatus = 'ANCHORED' | 'SIMULATED' | 'PENDING' | 'NONE';

export interface EvidenceMetrics {
  baseline_kwh?: number;
  savings_kwh?: number;
  co2e_kg?: number;
  money_inr?: number;
  renewable_kwh?: number;
}

export interface Evidence {
  id: string;
  company_id: string;
  ref: string; // EVD-…
  kind: EvidenceKind;
  title: string;
  facility_id?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  metrics: EvidenceMetrics;
  /** Exact canonical JSON that was fingerprinted. */
  canonical_json: string;
  sha256: string;
  anchor_status: AnchorStatus;
  onchain_hash?: string | null;
  tx_hash?: string | null;
  audited: boolean;
  auditor?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  file_sha256?: string | null;
  file_path?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
}

export type ClaimStatus = 'draft' | 'in_review' | 'approved' | 'rejected' | 'published';
export type ClaimChannel = 'annual_report' | 'brsr' | 'website' | 'advertising' | 'social' | 'press' | 'product' | 'other';
export type Verdict = 'SUPPORTED' | 'QUESTIONABLE' | 'UNSUPPORTED';

export interface Claim {
  id: string;
  company_id: string;
  text: string;
  channel: ClaimChannel;
  status: ClaimStatus;
  evidence_ids: string[];
  verdict?: Verdict | null;
  score?: number | null;
  owner_name?: string | null;
  publish_on?: string | null;
  decision_note?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  company_id: string;
  actor: string;
  action: string;
  entity: 'claim' | 'evidence' | 'energy' | 'facility' | 'company' | 'member';
  entity_id?: string | null;
  detail?: string | null;
  at: string;
}

export type IntegrityState = 'INTACT' | 'TAMPERED';
