export type AnchorStatus = 'ANCHORED' | 'SIMULATED' | 'PENDING' | 'FAILED';

/** The fields that are hashed. Mirrors the EcoCypher canonical MRV schema v1.0.0. */
export interface CanonicalEvidence {
  baseline_kwh: number;
  building_id: string;
  co2e_reduction_kg: number;
  economic_saving: number;
  intervention_id: string;
  post_intervention_kwh: number;
  savings_kwh: number;
  schema_version: string;
}

/** An evidence record as held in the wallet or returned by the impact API. */
export interface EvidenceRecord {
  evidence_id: string;
  title: string;
  /** Exact canonical JSON string that was hashed. Verification re-hashes this. */
  canonical_json: string;
  /** SHA-256 recorded when the evidence was created. */
  evidence_hash: string;
  /** Hash stored on-chain in EvidenceRegistry.sol, when anchored. */
  onchain_hash?: string;
  anchor_status: AnchorStatus;
  tx_hash?: string;
  block_number?: number;
  method: string;
  baseline_period?: string;
  reporting_period?: string;
  tariff_inr_per_kwh?: number;
  emission_factor?: number;
  emission_factor_source?: string;
  external_verification: 'PERFORMED' | 'NOT_PERFORMED';
  verifier?: string;
  source: 'demo' | 'api' | 'scan';
  demo_note?: string;
  created_at: string;
  saved_at?: string;
}

export type IntegrityState = 'INTACT' | 'TAMPERED' | 'UNREADABLE';

export interface VerificationResult {
  record: EvidenceRecord;
  evidence: CanonicalEvidence | null;
  computed_hash: string;
  integrity: IntegrityState;
  chain: 'MATCHED' | 'MISMATCHED' | 'NOT_ANCHORED';
  checked_at: string;
}
