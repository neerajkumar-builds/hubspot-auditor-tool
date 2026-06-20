# Architecture

## Overview
A Manifest V3 Chrome extension with two cooperating runtimes:

- **Popup** (`popup.html` + `popup.js`) — the UI. Detects the portal, lets the operator pick
  optional modules, triggers the run, shows the summary. Thin by design.
- **Content script / engine** (`content.js` + the `src/core` modules) — injected into
  `*.hubspot.com`. It holds the authenticated session, fetches the data, runs diagnostics,
  builds the workbook, and triggers the downloads. The engine lives here (not the popup) so
  a run **survives the popup being closed**.

Everything attaches to a single global namespace, `window.FFA`.

```
┌─ Popup (popup.html / popup.js) ───────────────┐
│  detect portal · module toggles · Run audit   │
└───────────────┬───────────────────────────────┘
                │ chrome.tabs.sendMessage({FFA_RUN_AUDIT, modules})
                ▼
┌─ Content script on app.hubspot.com (content.js) ─────────────┐
│  re-entrancy guard (one run per tab)                          │
│  1. read CSRF from cookie  → headers                          │
│  2. fetch workflows  (crm-search over object 0-44, paginated) │
│  3. resolve owners   (crm/v3/owners)                          │
│  4. map rows → FFA.COLUMNS                                     │
│  5. optional modules: properties / lists / forms / flowmaps   │
│  6. diagnostics (diagnostics.js)                              │
│  7. build .xlsx (xlsx.js) + .csv (csv.js)  → download         │
│  8. post FFA_PROGRESS messages back to the popup              │
└───────────────────────────────────────────────────────────────┘
```

## The data-source decision
HubSpot exposes automations three ways; only one is complete:

- **Public Automation API** (token) — returns definitions and on/off, but **not** enrollment
  counts or active-issue flags, and it can't see flows created by non-workflow tools. Tops
  out well below the true total.
- **Internal CRM object `0-44`** via the `crm-search` endpoint the UI itself calls — returns
  the **full** inventory **with** every metric. This is the path used.

Authentication is the operator's own session: cookies (`credentials: "include"`) plus a CSRF
header (`X-HubSpot-CSRF-hubspotapi`) read from the non-HttpOnly `hubspotapi-csrf` cookie. The
token is used only as a request header — never logged, stored, or sent anywhere else.

See [`ENDPOINTS.md`](ENDPOINTS.md) for the exact requests, payload shapes, and the
pagination/aggregation gotchas.

## Module pattern
Each optional audit is a self-contained file exposing one async function on `FFA`
(`auditProperties`, `auditLists`, `auditForms`, `auditFlows`). Each:

1. receives a context `{ origin, portalId, headers, rows, onProgress, ... }`,
2. fetches + maps its own data,
3. flags dead weight,
4. returns `{ model, sheet }` (or `sheets`) — a data model plus a ready-to-render workbook tab.

`content.js` runs only the selected modules, **each wrapped in its own try/catch**, so a
missing endpoint, a lower-tier portal, or an API change degrades to "skip this tab" and never
aborts the core workflow audit.

## The dependency-free Excel writer
`src/core/xlsx.js` builds a real `.xlsx` from scratch: it emits the OOXML parts
(`workbook.xml`, per-sheet XML, styles, content-types, rels) and packs them into a ZIP with a
hand-rolled CRC-32 + store/deflate container. No SheetJS, no CDN — which keeps the extension
MV3-compliant (no remote code) and dependency-free. `buildWorkbookBytes(rows, meta,
extraSheets)` renders the fixed workflow tabs and appends each module's sheet.

## Two variants, one engine
`src/core/` is the single source of truth. `src/internal/` and `src/external/` are thin
overlays (their own `manifest.json`, `popup.html`, `popup.js`; the external one adds the
lead gate). `tools/build.mjs` copies core + the chosen overlay into `dist/<variant>/` in the
flat layout MV3 expects. Because it's a pure copy, a built variant is byte-identical to its
source — the restructure changed organization, not behavior.

## Run sequence (happy path)
1. Operator clicks **Run audit**; popup sends `FFA_RUN_AUDIT` with the selected modules.
2. Engine sets its re-entrancy flag (a second click while running is rejected).
3. Workflows fetched page-by-page (stable sort, deduped), owners resolved, rows mapped.
4. Selected modules run sequentially, posting progress.
5. Diagnostics computed; `.xlsx` + `.csv` built and downloaded from the page context.
6. A summary is returned to the popup (and cached so a reopened popup can show the last run).

## Key design choices
- **Engine in the content script, not the popup** → runs survive popup close; one re-entrancy
  guard prevents the duplicate-download bug that a closeable popup otherwise invites.
- **Stable pagination sort** → `crm-search` offset paging is non-deterministic without an
  explicit sort, which silently corrupts counts. The engine sorts by record id and dedupes.
- **Graceful module isolation** → optional audits never threaten the proven core.
- **Client-side only** → no backend to secure; the trust story is structural, not promised.
