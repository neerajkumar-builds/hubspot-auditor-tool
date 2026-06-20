// External-variant lead-capture config — TEMPLATE.
//
// Setup: copy this file to `config-external.js` (same folder) and fill in your own
// values. `config-external.js` is gitignored, so real endpoints/secrets never get
// committed. The build copies whichever `config-external.js` exists into the external
// extension; if it's missing, the gate shows "lead capture not configured".
//
// The shared `secret` must match the SECRET constant in your n8n "Validate Lead" Code
// node (see ../../n8n/lead-capture.md). The audit itself never leaves the browser —
// only these lead fields are POSTed to your webhook. Also add your n8n host to the
// external manifest.json "host_permissions".
window.FFA = window.FFA || {};
FFA.LEAD = {
  webhook: "https://YOUR-N8N-HOST/webhook/YOUR-WEBHOOK-ID",   // <-- your n8n POST webhook
  secret: "REPLACE_WITH_YOUR_SHARED_SECRET",                  // <-- must match the n8n Code node
  consent: "We'll email your audit + occasional RevOps tips. No spam, unsubscribe anytime.",
  // The audit itself never leaves the browser — only these fields are sent to your webhook.
  fields: ["email", "name", "title", "company", "source"],

  // Anti-garbage (client side reduces noise; n8n is the authoritative filter — it re-checks
  // all of this since a public webhook can be POSTed to directly).
  // Disposable / throwaway email domains to reject (free webmail like gmail IS allowed).
  disposableDomains: [
    "mailinator.com", "10minutemail.com", "guerrillamail.com", "guerrillamail.info",
    "tempmail.com", "temp-mail.org", "trashmail.com", "yopmail.com", "getnada.com",
    "dispostable.com", "sharklasers.com", "throwawaymail.com", "maildrop.cc",
    "fakeinbox.com", "mailnesia.com", "tempinbox.com", "spamgourmet.com", "mohmal.com",
    "discard.email", "emailondeck.com", "mintemail.com", "test.com", "example.com",
    "example.org", "example.net", "email.com", "test.test", "asdf.com"
  ],
  // Obvious junk values (case-insensitive, exact-or-startswith on the local part / fields).
  junkValues: ["test", "testing", "asdf", "qwerty", "abc", "xxx", "aaa", "na", "n/a", "none", "demo", "sample"]
};
