import type { EvidenceRecord } from './types';

/**
 * Demo evidence. Hashes are real SHA-256 digests of `canonical_json`.
 * The third record is deliberately altered after hashing so the tamper check can be seen.
 */
export const SEED_RECORDS: EvidenceRecord[] = [
  {
    evidence_id: 'EVD-88A9F34C2B10',
    title: 'Chiller setpoint reset + VFD scheduling',
    canonical_json:
      '{"baseline_kwh":52400.0,"building_id":"BLD-HQ-BANGALORE-01","co2e_reduction_kg":7526.0,"economic_saving":95400.0,"intervention_id":"INT-2026-BLD01-HVAC-01","post_intervention_kwh":41800.0,"savings_kwh":10600.0,"schema_version":"1.0.0"}',
    evidence_hash: 'ae9bba0c1acfd74fe8b1689dadb655eec7318def9dd9ccdad34d89aa3a205b3b',
    anchor_status: 'SIMULATED',
    method: 'IPMVP Option C · whole-facility metering',
    baseline_period: '1–28 Feb 2026',
    reporting_period: '1–31 Mar 2026',
    tariff_inr_per_kwh: 9,
    emission_factor: 0.71,
    emission_factor_source: 'CEA CO₂ Baseline Database v21.0',
    external_verification: 'NOT_PERFORMED',
    source: 'demo',
    demo_note: 'Demo record: hashed but not anchored on a live chain.',
    created_at: '2026-03-31T21:14:02Z',
  },
  {
    evidence_id: 'EVD-3C71D0A4E95B',
    title: 'High-bay LED retrofit with daylight sensors',
    canonical_json:
      '{"baseline_kwh":31800,"building_id":"BLD-CAMPUS-MUMBAI-02","co2e_reduction_kg":5289.5,"economic_saving":63325,"intervention_id":"INT-2026-BLD02-LED-02","post_intervention_kwh":24350,"savings_kwh":7450,"schema_version":"1.0.0"}',
    evidence_hash: '5fdc0a4916b1d7f76865ac5abf3003fabde3a11968915c1cebcea2a2538e8eb4',
    onchain_hash: '0x5fdc0a4916b1d7f76865ac5abf3003fabde3a11968915c1cebcea2a2538e8eb4',
    anchor_status: 'ANCHORED',
    tx_hash: '0x9f2c41b7e08d3a65c1f47e2d9b80a3c56e71f4d28b9a0c3e5f61d7a28b4c90e13',
    block_number: 19845377,
    method: 'IPMVP Option B · lighting sub-meter',
    baseline_period: '1–30 Mar 2026',
    reporting_period: '21 Apr – 20 May 2026',
    tariff_inr_per_kwh: 8.5,
    emission_factor: 0.71,
    emission_factor_source: 'CEA CO₂ Baseline Database v21.0',
    external_verification: 'PERFORMED',
    verifier: 'Independent M&V auditor (demo)',
    source: 'demo',
    demo_note: 'Demo record: shows a fully anchored, independently verified example.',
    created_at: '2026-05-21T10:02:44Z',
  },
  {
    evidence_id: 'EVD-B5E2904F17AC',
    title: 'Night purge ventilation & baseload curtailment',
    canonical_json:
      '{"baseline_kwh":28600,"building_id":"BLD-HQ-BANGALORE-01","co2e_reduction_kg":4402,"economic_saving":55800,"intervention_id":"INT-2026-BLD01-BMS-03","post_intervention_kwh":19500,"savings_kwh":9100,"schema_version":"1.0.0"}',
    evidence_hash: 'c5e721072f8fcfe2c74d30aa0eca435341fd04afc335790ab2a228c005aca6c1',
    anchor_status: 'SIMULATED',
    method: 'IPMVP Option C · whole-facility metering',
    baseline_period: '1–30 Apr 2026',
    reporting_period: '1–15 May 2026',
    tariff_inr_per_kwh: 9,
    emission_factor: 0.71,
    emission_factor_source: 'CEA CO₂ Baseline Database v21.0',
    external_verification: 'NOT_PERFORMED',
    source: 'demo',
    demo_note: 'Demo record: savings were raised from 6,200 to 9,100 kWh after hashing, so verification fails.',
    created_at: '2026-05-16T08:30:00Z',
  },
];
