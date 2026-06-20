# n8n Lead-Capture Workflow

The external variant POSTs a lead to an n8n webhook. This is the design of the receiving
workflow. No real URL or secret appears here — set those in your own n8n instance and in
`src/external/config-external.js`.

## Shape
```
Webhook (POST)  →  Validate Lead (Code)  →  Valid lead? (IF)  ─true→  your storage/CRM node
                                                              └false→ (drop, or log/count)
```

## 1. Webhook node
- HTTP Method: **POST** (not GET — the lead is a JSON body).
- Path: your webhook id. Note the **production** URL (use it in the extension config); the
  **test** URL only fires while the n8n editor is actively listening.
- After changing the method, **publish** the workflow so the active version accepts POST.

## 2. Validate Lead (Code node, run once for all items)
Re-checks everything server-side, because the webhook is public and the extension's checks
are bypassable. Tags each item with `lead_quality` (`valid` / `rejected`) and `reject_reason`.

Checks, in order: `chrome-extension://` origin → shared secret header (`x-ffa-secret`) →
email format → disposable domain → junk values → minimum name/company length. The `SECRET`
constant **must match** `FFA.LEAD.secret` in the extension config.

```js
const SECRET = "REPLACE_WITH_YOUR_SHARED_SECRET";
const DISPOSABLE = [/* same list as config-external */];
const JUNK = ["test","testing","asdf","qwerty","abc","xxx","aaa","na","n/a","none","demo","sample"];
const isJunk = (v) => { const s = String(v||"").toLowerCase().trim(); return !!s && JUNK.some(k => s===k || s.startsWith(k)); };
const out = [];
for (const item of $input.all()) {
  const h = item.json.headers || {}, b = item.json.body || {};
  const email = String(b.email||"").toLowerCase().trim();
  const name = String(b.name||"").trim(), company = String(b.company||"").trim();
  let valid = true, reason = "";
  if (!String(h.origin||"").startsWith("chrome-extension://")) { valid=false; reason="bad_origin"; }
  else if (String(h["x-ffa-secret"]||"") !== SECRET) { valid=false; reason="bad_secret"; }
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { valid=false; reason="bad_email"; }
  else { const [local, domain] = [email.split("@")[0], email.split("@")[1]||""];
    if (DISPOSABLE.indexOf(domain) !== -1) { valid=false; reason="disposable_domain"; }
    else if (isJunk(local)||isJunk(name)||isJunk(company)) { valid=false; reason="junk_value"; }
    else if (name.replace(/\s/g,"").length < 2) { valid=false; reason="short_name"; }
    else if (company.length < 2) { valid=false; reason="short_company"; } }
  out.push({ json: { ...b, lead_quality: valid ? "valid" : "rejected", reject_reason: reason } });
}
return out;
```

## 3. Valid lead? (IF node)
Condition: `{{ $json.lead_quality }}` equals `valid`.
- **TRUE output** → connect your storage/CRM (HubSpot contact, Google Sheet, Slack alert…).
- **FALSE output** → leave unconnected to drop, or attach a counter to monitor spam volume.

## Verified behavior
- real lead → TRUE
- `test@test.com` → FALSE (`disposable_domain`)
- direct curl without the secret/origin → FALSE (`bad_origin`)

## Lead payload
```json
{ "email": "...", "name": "...", "title": "...", "company": "...",
  "source": "...", "portalId": "...", "ts": "ISO-8601" }
```
Only these fields. The audit data is never sent.
