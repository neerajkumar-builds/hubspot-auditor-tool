# Chrome Web Store kit — FullFunnel HubSpot Audit (Free)

Everything you need to publish the external variant. **Recommended visibility: Unlisted** (installable only via your link — ideal for handing to prospects). Switch to Public later if you want store discoverability.

---
## 0. Before you submit (one-time)
- [ ] Google account → register as a Chrome Web Store developer ($5 one-time): https://chrome.google.com/webstore/devconsole
- [ ] Host the privacy policy (`external/PRIVACY_POLICY.md`) somewhere public (your site / Notion / a gist) → copy the URL.
- [ ] **Wire the lead webhook** (see §5) so the gate actually captures — do this before submitting.

## 1. Listing copy
- **Name:** FullFunnel HubSpot Audit (Free)
- **Short description (≤132 chars):** One-click HubSpot hygiene audit — dead/duplicate/broken workflows, unused lists & fields, plus a cleanup plan, in Excel.
- **Category:** Productivity (alt: Developer Tools)
- **Detailed description (draft):**
  > Audit any HubSpot account in one click. While you're logged in, FullFunnel HubSpot Audit inventories every workflow — flagging what's switched off, dormant, silently erroring, or duplicated — and (optionally) your lists, custom properties, forms, and flow step-maps. It exports a clean, branded Excel report with a ready-to-action cleanup plan.
  >
  > • No token, no API key, no IT request — it reads your logged-in session.
  > • Your HubSpot data never leaves your browser; the report downloads to your device.
  > • Built by FullFunnel, a revenue-operations firm.
- **Screenshots (1280×800 or 640×400) — you capture:** (1) the unlock form, (2) the results summary popup, (3) the Excel Diagnostic + Remediation Plan tabs, (4) the Lists/Properties tabs.
- **Small promo tile (440×280):** the FullFunnel mark on dark.

## 2. Privacy tab answers (Web Store "Privacy practices")
- **Single purpose:** "Audit a HubSpot account's automations and related objects and export a report; capture the user's contact details to deliver it."
- **Permission justifications:**
  - `activeTab` / `scripting` — read the workflow/object data on the HubSpot tab the user is viewing, to build the audit.
  - `storage` — remember that the user unlocked the tool (avoid re-asking).
  - `downloads` — save the generated Excel/CSV report to the user's device.
  - host `*.hubspot.com` / `*.hubapi.com` — read the user's own HubSpot data via their session to generate the audit.
  - host `<your n8n domain>` — send only the user's submitted contact details to deliver the audit.
- **Remote code:** **No** (all code is bundled; no CDN/eval).
- **Data collected:** Personally identifiable information — **name, email** (+ title, company). Used for **account communication / the requested service**. **Not sold.** Not used for creditworthiness/lending. Not collecting health, financial, authentication, location, or web-history data.
- **Data handling certifications:** check all three (comply with policies; don't sell; use only for the disclosed purpose).
- **Privacy policy URL:** [paste your hosted PRIVACY_POLICY URL]

## 3. Note on "your HubSpot data isn't collected"
Make this explicit in the listing + privacy tab — it's true (audit stays client-side) and it's your trust differentiator + smooths review.

## 4. Submission steps
1. [ ] Zip the `external/hubspot-auditor-free/` folder (the build script produces `FullFunnel-HubSpot-Audit-Free-v1.0.zip`).
2. [ ] Dev console → New item → upload the zip.
3. [ ] Fill Listing (copy above) + Privacy tab (§2) + screenshots.
4. [ ] Set **Visibility = Unlisted**.
5. [ ] Submit for review (typically a few days; broad host perms + PII draw questions — answer with §2/§3).

## 5. Wiring the lead webhook (must do before submit)
1. In `external/hubspot-auditor-free/src/config-external.js`, set `FFA.LEAD.webhook = "https://<your-n8n>/webhook/..."`.
2. In `external/hubspot-auditor-free/manifest.json`, add your n8n origin to `host_permissions` (e.g. `"https://<your-n8n-domain>/*"`).
3. Reload + test: submit the form → confirm the lead JSON `{email,name,title,company,source,portalId,ts}` lands in n8n.
*(Give me the webhook URL and I'll set both + re-test + produce the final zip.)*

## 6. Anti-garbage / lead quality (built — how it works)
Two layers; the n8n one is authoritative (the webhook URL is public, so client checks are bypassable).
- **Extension gate (reduces noise):** hidden honeypot field (bots fill it → silently dropped, no POST), strict email format, rejects disposable domains + obvious junk (`test`, `asdf`, …) + too-short name/company. Sends a shared secret header `x-ffa-secret` + the `chrome-extension://` origin.
- **n8n workflow (enforces):** `Webhook → Validate Lead (Code) → Valid lead? (IF)`. The Code node re-checks origin + secret + email + disposable-domain + junk and tags `lead_quality` ("valid"/"rejected") + `reject_reason`. The IF node routes: **TRUE output = real leads, FALSE output = junk/bots.**
  - **YOU must connect your storage/CRM node (HubSpot/Sheet/Slack) to the IF's TRUE (top) output.** Leave FALSE (bottom) unconnected to drop junk, or attach a log/counter.
  - Tested: real lead → TRUE; `test@test.com` → FALSE (disposable_domain); direct curl w/o secret → FALSE (bad_origin).
  - The shared secret lives in `src/config-external.js` (`FFA.LEAD.secret`) and in the n8n Code node's `SECRET` const — **keep them identical** if you rotate it.
- Stronger options if spam persists: require business email (block free webmail), or add a deliverability API (ZeroBounce/NeverBounce) as an n8n node, or a CAPTCHA. Not enabled now.

## 7. Stability note
The audit reads HubSpot's undocumented internal endpoints. If HubSpot changes them, the tool breaks until patched — plan a quick-update cadence (re-upload a new version to the store) if this goes wide.
