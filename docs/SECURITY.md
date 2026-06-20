# Security & Data Handling

## Principles
1. **The audit never leaves the browser.** All HubSpot data is fetched, processed, and
   written to a local file in the page context. No CRM data is sent to any server.
2. **No stored credentials.** The tool uses the operator's existing HubSpot session. It never
   reads, stores, or transmits a password, API token, or session cookie value.
3. **Read-only.** Every HubSpot call is a read. The tool never writes, edits, or deletes.
4. **No remote code (MV3).** All logic is bundled and reviewable; nothing is fetched and
   executed at runtime. The `.xlsx` writer is hand-rolled specifically to avoid a CDN dependency.
5. **Least privilege.** Permissions are limited to what a read-and-download tool needs.

## The CSRF token
HubSpot's internal endpoints require a CSRF header. The engine reads it from the non-HttpOnly
`hubspotapi-csrf` cookie and sends it **only** as the `X-HubSpot-CSRF-hubspotapi` request
header on calls to HubSpot's own origin. It is never logged, never written to storage, never
included in any message to the popup, and never sent anywhere except HubSpot.

## Permissions (why each is needed)
- `activeTab` / `scripting` — read the workflow/object data on the HubSpot tab in view.
- `storage` — remember the last run summary (internal) / unlock state (external). Counts only.
- `downloads` — save the generated Excel/CSV to the operator's device.
- host `*.hubspot.com`, `*.hubapi.com` — read the operator's own HubSpot data via their session.
- host `<n8n>` (external only) — send the lead form fields to the configured webhook.

## Lead capture (external variant only)
The only outbound data, and only in the external build: the form fields **email, name, title,
company, source** (plus the portal id and a timestamp), POSTed to a self-hosted n8n webhook.
The audit data is never part of this payload. Consent is shown on the form. See
[`PRIVACY_POLICY.md`](PRIVACY_POLICY.md).

### Anti-abuse (two layers)
The webhook is public, so client-side checks are advisory and the server is authoritative.
- **Extension (reduces noise):** a hidden honeypot field (bots fill it → silently dropped),
  strict email format, disposable-domain + junk-value rejection, minimum field lengths, and a
  shared secret header. Free webmail (gmail/outlook) is allowed on purpose.
- **n8n (enforces):** re-checks the `chrome-extension://` origin, the shared secret, the email
  format, disposable domains, and junk values; routes real leads vs junk/bots. See
  [`../n8n/lead-capture.md`](../n8n/lead-capture.md).

## Threat model (brief)
| Threat | Mitigation |
| --- | --- |
| Credential/CRM exfiltration | Nothing leaves the browser; no backend; read-only. |
| Token leakage | CSRF token used only as a header to HubSpot; never logged/stored/messaged. |
| Remote code injection | MV3 + no remote code; no `eval` of network content; dependency-free. |
| Spam/garbage leads (external) | Honeypot + client validation + authoritative n8n filter. |
| Spoofed direct webhook POST | n8n rejects on missing/invalid origin + secret (verified). |
| Over-broad permissions | Minimal permission set, each justified above. |

## Honest limitations
- The shared secret ships in public extension code; it stops casual/bot spam, not a
  determined attacker who reads it. Escalation paths (business-email-only, a deliverability
  API, CAPTCHA) are documented but not enabled.
- The tool relies on HubSpot's undocumented internal endpoints; a HubSpot change can break a
  module until patched. Modules fail soft so one break never takes down the rest.
