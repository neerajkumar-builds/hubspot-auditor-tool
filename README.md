# HubSpot Workflow Auditor

A Manifest V3 Chrome extension that audits a HubSpot account in one click — workflows,
lists, custom properties, forms, and what each workflow actually does — then exports a
branded Excel report with a ready-to-action cleanup plan.

It runs entirely on the operator's **logged-in HubSpot session**. No API token, no OAuth
app, no IT request. The audit is processed in the browser and the data never leaves the
device.

Built by **Neeraj Kumar** for **FullFunnel**.

---

## Why it exists

Every long-lived HubSpot account accumulates automation debt: workflows left on that do
nothing, ones quietly erroring, dozens of near-duplicates built by different people over
the years, plus thousands of unused lists and custom fields. HubSpot's own UI never totals
this up, so the rot stays invisible until someone goes looking.

This tool makes that first pass instant. It is the opening move on any HubSpot
engagement — a concrete, prioritized picture of what to fix, retire, and consolidate.

## What it produces

A multi-tab Excel workbook (plus the raw CSV):

| Tab | Contents |
| --- | --- |
| **Diagnostic** | Headline counts and findings |
| **Remediation Plan** | Scoped, sequenced cleanup proposal — fix / delete / consolidate, with targets |
| **Consolidation Map** | Near-duplicate workflow clusters |
| **Cleanup Queue** | Every flagged workflow, prioritized (errors → never-used → dormant → off) |
| **All / Active / Inactive** | Full workflow inventory with enrollment + issue metrics |
| **Properties** | Custom-field hygiene; optional fill-rate to surface never-used fields |
| **Lists** | Empty and unused (zero-reference) lists |
| **Forms** | Unpublished and stale forms |
| **Flow Maps** | Step-by-step of what each active workflow does |
| **Conflicts** | Properties written by more than one active workflow (race conditions) |

On a production portal (~63k contacts) the workflow audit reproduces a hand-built
reference exactly: **229 workflows · 134 on / 95 off · 14 erroring · 111 dormant ·
10 never-enrolled**, with ~40% of flows in near-duplicate clusters — plus **534 lists
(≈344 dead)** and **~590 custom properties (~350 undocumented, 120 never used on contacts
alone)**.

## How it works (short version)

HubSpot models every automation as an internal CRM object (`0-44`). The extension reads it
through the same authenticated endpoint the HubSpot UI uses (`crm-search`), authenticated
by the session cookies plus a CSRF header sourced from a non-HttpOnly cookie. This is the
only path that returns the full inventory **with** enrollment and active-issue metrics — the
public Automation API exposes neither. Diagnostics run client-side; the Excel file is
generated in-browser by a dependency-free `.xlsx` writer. Full detail in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/ENDPOINTS.md`](docs/ENDPOINTS.md).

## Two variants

- **internal** — for the team. No gate, fully client-side.
- **external** — a free, branded lead-gen build: a short form captures a contact (sent to
  an n8n webhook) before unlocking the same audit. The audit itself still never leaves the
  browser; only the form fields are sent. See [`docs/WEB_STORE_KIT.md`](docs/WEB_STORE_KIT.md).

Both are assembled from a single shared engine (`src/core/`) by the build script.

## Build & run

```bash
npm run build           # assemble dist/internal and dist/external
npm test                # build, then run the validation harness
npm run package         # build, then zip each variant into dist/zips/
```

Then load it:

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select `dist/internal` (or `dist/external`)
3. Open a HubSpot account you're logged into, reload the tab once, click the icon → **Run audit**

The external variant needs a lead webhook: copy `src/external/config-external.example.js`
to `config-external.js` and fill in your n8n URL + shared secret (see
[`n8n/lead-capture.md`](n8n/lead-capture.md)).

## Stack

Vanilla JavaScript, **zero runtime dependencies**. Manifest V3, no remote code, no bundler.
Node 18+ only for the build/test scripts. The Excel writer (`src/core/xlsx.js`) is a
from-scratch OOXML + ZIP encoder — no SheetJS.

## Docs

- [`docs/PRD.md`](docs/PRD.md) — product requirements
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design and data flow
- [`docs/FILES.md`](docs/FILES.md) — what every file does + the `FFA.*` API
- [`docs/ENDPOINTS.md`](docs/ENDPOINTS.md) — the HubSpot endpoints and their gotchas
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model and data handling
- [`docs/TESTING.md`](docs/TESTING.md) — how validation works
- [`LICENSE-NOTICE.md`](LICENSE-NOTICE.md) — ownership

> "HubSpot" is a trademark of HubSpot, Inc. This is an independent tool, not affiliated with HubSpot.
