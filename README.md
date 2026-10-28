# EcoCypher ESG

A workspace for **company ESG teams** that turns sustainability from claims-based trust into evidence-based accountability.
Every green claim is checked against fingerprinted evidence and real energy data *before* it is published.
Works on phones, tablets and desktops, and installs as an app (PWA).

| Area | What ESG managers do there |
| --- | --- |
| **Overview** | Scope 1 + 2 emissions, energy (GJ), renewable share and year-on-year change; claims pipeline; greenwashing-risk score; alerts for altered evidence and risky approved claims |
| **Claims register** | Log every claim for reports, BRSR, website, ads, social and press. A rule-based check runs as you type (vague or absolute wording, offsets, pledges, time period, evidence integrity, anchoring, audit, and claimed figures vs evidence and company data). Draft → in review → approved / rejected → published, with an audit trail. Approving an unsupported claim needs a written justification. |
| **Evidence library** | Upload bills, meter exports, audit reports and certificates, or import EcoCypher MRV records by QR code. Each item gets a SHA-256 fingerprint; any later change shows as **altered** and stops supporting claims. |
| **Facilities & energy** | Monthly grid and renewable electricity, diesel and LPG per facility (form or CSV import), linked to evidence. |
| **Reports** | BRSR Section C, Principle 6 (energy and Scope 1/2 emissions, intensity per ₹ crore turnover), approved claims and an evidence index with fingerprints. Export CSV / JSON or print to PDF. |
| **Settings** | Company profile, turnover, emission factors, team roles (admin / manager / viewer) and invites. |

## Run it

```bash
npm install
npm run dev     # http://localhost:5173 (demo workspace with a sample company)
npm test
npm run build
```

Without Supabase settings the app runs a **demo workspace** (sample textile company, stored only in your browser),
so you can try every feature immediately.

## Use it with your team (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. In **SQL editor**, run `supabase/migrations/001_esg_workspace.sql`. It creates the tables, row-level security
   (each company sees only its own data; evidence and the audit trail are append-only), invite functions and a private
   `evidence` storage bucket.
3. In **Authentication → URL configuration**, add your site URL (e.g. your Vercel domain) to the redirect URLs.
4. Copy **Project URL** and **anon public key** from Settings → API into `.env` (or Vercel environment variables):

   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
5. Deploy. The first person to sign up creates the company and becomes its admin, then invites managers by email
   from Settings. Invited people join when they sign in with that email.

## Deploy on Vercel

Import the repo, framework **Vite**, build `npm run build`, output `dist`, and add the two environment variables.
`vercel.json` handles SPA routing, and `/verify/EVD-…` links from EcoCypher QR receipts open the matching evidence.

## Method notes

- Financial years run April–March (Indian FY).
- Energy content: electricity 0.0036 GJ/kWh; diesel 0.0358 GJ/L; LPG 0.0473 GJ/kg (IPCC 2006 net calorific values).
- Default emission factors (editable per company): grid 0.71 kg CO₂e/kWh (CEA CO₂ Baseline Database), diesel 2.68 kg/L,
  LPG 2.98 kg/kg (IPCC 2006). Check the latest CEA database version for your reporting year.
- Evidence fingerprints use canonical JSON (sorted keys, compact) hashed with SHA-256 in the browser (Web Crypto).
  Imported MRV records keep the canonical JSON and hash issued by the EcoCypher impact platform.
- The claim check is deterministic and explainable (`src/lib/claims.ts`); it supports, not replaces, legal review.

## Brand

Deep Forest Green `#14583F` · Guru Gold `#E4B347` · Mangal Vermilion `#C74736` · Warm Ivory `#FAF6EA` · Forest Charcoal `#24352D`
