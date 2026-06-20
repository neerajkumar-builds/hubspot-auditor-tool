// Lead-capture POST (popup context). Sends ONLY the gate fields to the configured n8n
// webhook. Never sends audit data. Throws on misconfig / failure so the popup can show it.
window.FFA = window.FFA || {};
FFA.submitLead = async function (lead) {
  const url = (FFA.LEAD && FFA.LEAD.webhook) || "";
  if (!url) { const e = new Error("Lead capture isn't configured yet (no webhook)."); e.code = "NO_WEBHOOK"; throw e; }
  const secret = (FFA.LEAD && FFA.LEAD.secret) || "";
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ffa-secret": secret },
      body: JSON.stringify(lead)
    });
  } catch (e) {
    throw new Error("Couldn't reach the lead endpoint — check the webhook URL is in host_permissions.");
  }
  if (!res.ok) throw new Error("Submit failed (HTTP " + res.status + ").");
  return true;
};
