# EcoCypher Companion

A mobile-first companion app for the [EcoCypher](https://github.com/Samhita-Hejmadi/ECOCYPHER) MRV platform.
It moves sustainability from claims-based trust to evidence-based accountability, in your pocket:

- **Scan** an EcoCypher QR receipt with the camera (or upload a photo, or type the ID).
- **Verify** the evidence on your own device: the canonical record is re-hashed with SHA-256 and compared with the
  hash recorded at creation and, when anchored, the copy in `EvidenceRegistry.sol`. One changed digit shows as **Evidence was altered**.
- **Check a claim**: paste a green claim, attach evidence, and get a verdict (*Supported / Questionable / Not supported*)
  with the reason for every rule.
- **Wallet**: keep the records you’ve scanned; integrity is re-checked every time the app opens.

Works on phones, tablets and desktops, installs to the home screen (PWA) and keeps working offline.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # rules engine + hashing tests
npm run build      # production build in dist/
```

## Connect your EcoCypher server

The app ships with three sample records so it works without a backend. To look up live evidence, open
**Settings → EcoCypher server** and enter your impact API address (it must be `https://` when the app is served over HTTPS,
and the API must allow the app’s origin via CORS). The app uses:

| Endpoint | Used for |
| --- | --- |
| `GET /api/health` | Connection test |
| `GET /api/mrv/:evidence_id` | Canonical JSON + recorded hash |
| `GET /api/verify/:evidence_id` | On-chain hash and anchor status |

You can also set a default with `VITE_DEFAULT_API_URL` (see `.env.example`).

## How the claim check works

Rules run locally and are fully explainable (`src/lib/claims.ts`):

| Rule | Fails / warns when |
| --- | --- |
| Measurable result | No figure with a unit (kWh, tCO₂e, %, ₹) |
| Vague wording | “eco-friendly”, “green”, “sustainable”… |
| Absolute claims | “carbon neutral”, “net zero”, “100% renewable” without full-scope accounting |
| Offsets / future pledges | Relies on offsets, or describes a target instead of a result |
| Time period | No date or period |
| Evidence integrity | Recomputed SHA-256 ≠ recorded hash |
| Anchoring / audit | Not anchored on-chain; no independent verifier |
| Figures vs evidence | Claimed kWh, CO₂e, % or ₹ exceed the verified values by more than 2% |

## Deploy

Ready for Vercel (`vercel.json` included): import the repo, framework *Vite*, build `npm run build`, output `dist`.
Deep links from platform QR codes (`/verify/EVD-…` or `?verify=EVD-…`) open the right record.

## Brand

Deep Forest Green `#14583F` · Guru Gold `#E4B347` · Mangal Vermilion `#C74736` · Warm Ivory `#FAF6EA` · Forest Charcoal `#24352D`
