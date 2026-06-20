# File-by-file reference

Repository layout and what each file is responsible for.

```
src/core/        shared engine (single source of truth)
src/internal/    internal-variant overlay (popup + manifest)
src/external/    external-variant overlay (popup + gate + manifest)
assets/icons/    extension icons + brand mark
tools/           build, package, and the standalone Python report builder
tests/           validation harness
docs/, n8n/      documentation
dist/            build output (generated; gitignored)
```

## `src/core/` — the engine (shared by both variants)

| File | Responsibility |
| --- | --- |
| `config.js` | Constants + the `FFA` namespace. Brand colors, `FFA.COLUMNS` (CSV schema), object-type / source-app / trigger label maps, the `FFA.SESSION` request spec, `FFA.buildUrl`, and `FFA.mapSessionRow` (raw `0-44` record → schema row, with owner resolution). |
| `content.js` | The audit engine. Reads the CSRF cookie, fetches + paginates workflows, resolves owners, runs the selected modules (each in try/catch), computes diagnostics, builds + downloads the `.xlsx`/`.csv`, posts progress, and enforces the one-run-per-tab guard. Message API: `FFA_PORTAL_PING`, `FFA_STATUS`, `FFA_RUN_AUDIT`. |
| `diagnostics.js` | Pure functions over mapped rows: `computeDiagnostics` (on/off, dormant, never-enrolled, has-errors, totals), `clusterDuplicates` (Jaccard near-duplicate clustering), `checkAcceptance` (compare to the reference oracle). No I/O — fully unit-testable. |
| `csv.js` | `toCSV` (exact `FFA.COLUMNS` order, RFC-4180 quoting) and `downloadCSV`. |
| `xlsx.js` | Dependency-free `.xlsx` writer: OOXML part builders + a hand-rolled ZIP/CRC-32 container, the audit model (`buildAuditModel`), the workbook builder (`buildWorkbookBytes`), shared cell helpers (`FFA.xl`), and `downloadXLSX`. |
| `audit-properties.js` | `FFA.auditProperties` — custom-field hygiene; optional fill-rate via the `MISSING` aggregation. Returns the Properties sheet. |
| `audit-lists.js` | `FFA.auditLists` — empty / unused lists. Returns the Lists sheet. |
| `audit-forms.js` | `FFA.auditForms` — unpublished / stale forms. Returns the Forms sheet. |
| `audit-flowmaps.js` | `FFA.auditFlows` — per-flow step-maps + property-write conflict detection. Returns the Flow Maps and Conflicts sheets. |

## `src/internal/` — internal variant overlay

| File | Responsibility |
| --- | --- |
| `manifest.json` | MV3 manifest; loads the core engine as content scripts on `*.hubspot.com`. |
| `popup.html` | The audit UI (module toggles, results card). |
| `popup.js` | Detects the portal, sends `FFA_RUN_AUDIT`, renders progress + summary, reflects an in-flight run on reopen. |

## `src/external/` — external (lead-gen) variant overlay
Same three files as internal, plus:

| File | Responsibility |
| --- | --- |
| `leadgate.js` | `FFA.submitLead` — POSTs the lead (with the shared secret header) to the configured n8n webhook. |
| `config-external.example.js` | Template config: webhook URL, shared secret, consent line, disposable-domain + junk-value lists. Copy to `config-external.js` (gitignored) with real values. |
| `popup.html` / `popup.js` | Add the email-gate (honeypot + validation) in front of the same audit UI; unlock state persists in `chrome.storage.local`. |

## `tools/`

| File | Responsibility |
| --- | --- |
| `build.mjs` | Assemble `dist/<variant>/` from core + overlay; inject the n8n host into the external manifest from config. |
| `package.mjs` | Zip each built variant into `dist/zips/`. |
| `build_audit.py` | Standalone alternative: turn an exported CSV into the Excel report via Python/openpyxl. Predates the in-extension writer; kept as a reference / offline path. |

## `tests/`
`audit.test.mjs` — loads the real core modules in a `node:vm` sandbox and asserts diagnostics
rules, row mapping, each module's flags, the lead-validation rules, and that the `.xlsx`
writer emits a valid workbook. Synthetic fixtures only. See [`TESTING.md`](TESTING.md).

## The `FFA.*` API (quick reference)
- `FFA.COLUMNS`, `FFA.SESSION`, `FFA.OBJECT_TYPE_MAP`, `FFA.SOURCE_APP_MAP`, `FFA.TRIGGER_LABEL`, `FFA.ACCEPTANCE`, `FFA.BRAND`
- `FFA.buildUrl(portal, id)`, `FFA.mapSessionRow(raw, portalId, ownerMap)`
- `FFA.computeDiagnostics(rows)`, `FFA.clusterDuplicates(rows)`, `FFA.checkAcceptance(totals)`
- `FFA.toCSV(rows)`, `FFA.downloadCSV(csv, name)`
- `FFA.buildAuditModel(rows)`, `FFA.buildWorkbookBytes(rows, meta, extraSheets)`, `FFA.downloadXLSX(bytes, name)`, `FFA.xl`
- `FFA.auditProperties|auditLists|auditForms|auditFlows(ctx)`
- External only: `FFA.LEAD`, `FFA.submitLead(lead)`
