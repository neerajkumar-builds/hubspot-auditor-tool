# Testing & Validation

## Two levels of validation

### 1. Automated harness (`tests/audit.test.mjs`)
Runs in pure Node with no dependencies. It loads the real `src/core` modules in a
`node:vm` sandbox (a fake `window`/`FFA`, a stubbed `fetch` per case) and asserts the logic on
synthetic fixtures:

- **diagnostics** — on/off, dormant, never-enrolled, has-errors, duplicate clusters, and the
  acceptance check against the reference numbers.
- **mapSessionRow** — status, object-type mapping, trigger labels, re-enrollment, owner
  resolution, URL uses `hs_flow_id`, unmapped object types pass through.
- **xlsx writer** — emits a Uint8Array that begins with the `PK` ZIP magic and is non-trivial
  in size; CSV header matches `FFA.COLUMNS`.
- **audit modules** — properties (+ fill-rate never-used flag), lists (empty/unused), forms
  (unpublished/stale), flow maps (step labels) and conflicts (shared property writes).
- **lead validation** — rejects `test@test.com`, disposable domains, and junk; allows real
  webmail and business email.

Run it:
```bash
npm test          # builds, then runs the harness
node tests/audit.test.mjs
```
Expected: `PASS — N passed, 0 failed`.

### 2. Live oracle parity (manual, not in the repo)
The workflow audit was validated against a hand-built reference produced from a real portal.
On that portal the tool reproduces the totals **exactly**: 229 workflows · 134 on / 95 off ·
14 erroring · 111 dormant · 10 never-enrolled. The add-on modules and the n8n lead filter were
each verified live (the filter with valid, junk, and spoofed payloads).

The reference data contains real CRM and personal data, so it is **not committed**. The
automated harness uses synthetic fixtures that exercise the same code paths.

## Build-parity check (non-breaking guarantee)
Because both variants are assembled from one shared engine by a pure-copy build, a built
variant is byte-identical to its source. When restructuring, diff `dist/internal` and
`dist/external` against the previously shipped builds — only intentional changes (e.g. an
externalized secret placeholder) should differ.

## Manual smoke test (loaded extension)
1. `npm run build`, load `dist/internal` unpacked, open a logged-in HubSpot tab (reload once).
2. Run audit with no modules → Excel + CSV download; totals match expectations.
3. Click Run again immediately → it refuses a second concurrent run.
4. Tick Lists + Properties (+ fill-rate) → those tabs appear with sensible numbers.
5. External: confirm the gate blocks until the form submits, the lead lands in n8n, and the
   audit then runs identically.
