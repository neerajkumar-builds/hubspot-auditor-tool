// External popup: an email-gate that unlocks the same audit UI as the internal tool.
// Only the gate fields are POSTed (to the n8n webhook in config-external.js); the audit
// itself runs in the content script and stays 100% client-side.
let PORTAL = null, TAB_ID = null, BUSY = false;
const $ = (id) => document.getElementById(id);
const setStatus = (t) => ($("status").textContent = t || "");

(async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    TAB_ID = tab && tab.id;
    const m = tab && tab.url && tab.url.match(/hubspot\.com\/[^/]+\/(\d+)/);
    PORTAL = m ? m[1] : null;
    const pill = $("portal");
    if (PORTAL) { pill.textContent = "Portal " + PORTAL; pill.classList.add("live"); }
    else { pill.textContent = "open HubSpot"; }
  } catch (e) { $("portal").textContent = "unknown"; }

  $("consent").textContent = (FFA.LEAD && FFA.LEAD.consent) || "";
  const { ffa_unlocked } = await chrome.storage.local.get("ffa_unlocked");
  if (ffa_unlocked) showApp();
  else showGate();
})();

function showGate() {
  $("gate").style.display = "block"; $("app").style.display = "none";
  if (!FFA.LEAD || !FFA.LEAD.webhook) {
    $("unlock").disabled = true;
    $("gate-msg").textContent = "Lead capture isn't configured yet (set the webhook in src/config-external.js).";
  }
}
function showApp() {
  $("gate").style.display = "none"; $("app").style.display = "block";
  // if a run is already in flight (popup reopened mid-run), reflect it
  if (TAB_ID) chrome.tabs.sendMessage(TAB_ID, { type: "FFA_STATUS" })
    .then((st) => { if (st && st.running) { busy(true); setStatus("Audit already running in this tab — it'll finish and download automatically."); } })
    .catch(() => {});
}

// ---- lead validation (client side; n8n re-checks all of this authoritatively) ----
function isJunk(v) {
  const s = String(v || "").toLowerCase().trim();
  if (!s) return false;
  return (FFA.LEAD.junkValues || []).some((j) => s === j || s.startsWith(j));
}
function validateLead(email, name, company) {
  const e = email.toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e)) return "Enter a valid work email.";
  const domain = e.split("@")[1] || "";
  const local = e.split("@")[0] || "";
  if ((FFA.LEAD.disposableDomains || []).indexOf(domain) !== -1) return "Please use a real (non-disposable) email.";
  if (isJunk(local) || isJunk(name) || isJunk(company)) return "Please enter your real details.";
  if (name.replace(/\s/g, "").length < 2) return "Enter your full name.";
  if (company.length < 2) return "Enter your company.";
  return null;
}

// ---- gate submit ----
$("unlock").addEventListener("click", async () => {
  // honeypot: a real user can't see/fill #f-website. If it has a value, it's a bot —
  // pretend success and silently drop (no POST).
  if ($("f-website").value.trim()) { showApp(); return; }

  const email = $("f-email").value.trim(), name = $("f-name").value.trim(), company = $("f-company").value.trim();
  const err = validateLead(email, name, company);
  if (err) return ($("gate-msg").textContent = err);

  const lead = {
    email, name, company,
    title: $("f-title").value.trim(), source: $("f-source").value.trim(),
    portalId: PORTAL, ts: new Date().toISOString()
  };
  $("unlock").disabled = true; $("gate-msg").textContent = "Submitting…";
  try {
    await FFA.submitLead(lead);
    await chrome.storage.local.set({ ffa_unlocked: true, ffa_lead: { email: lead.email, ts: lead.ts } });
    showApp();
  } catch (e) {
    $("unlock").disabled = false;
    $("gate-msg").textContent = e.code === "NO_WEBHOOK" ? "Lead capture isn't configured yet." : ("Couldn't submit: " + ((e && e.message) || e));
  }
});

// ---- audit UI (same behaviour as the internal tool) ----
const PHASE = {
  owners: [5, "Resolving owners…"], flows: [50, "Reading workflows"],
  properties: [55, "Scanning properties…"], lists: [62, "Scanning lists…"], forms: [68, "Scanning forms…"],
  flowmaps: [80, "Mapping flow steps…"], building: [95, "Building Excel…"], done: [100, "Done"]
};
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "FFA_PROGRESS") return;
  const bar = $("bar").firstElementChild;
  const pl = PHASE[msg.phase] || [50, "Working…"];
  let pct = pl[0], label = pl[1];
  if (msg.phase === "flows" && msg.total) { pct = 5 + Math.round((msg.n / msg.total) * 45); label = `Reading workflows ${msg.n} / ${msg.total}…`; }
  else if (msg.phase === "flowmaps" && msg.total) { pct = 72 + Math.round((msg.n / msg.total) * 20); label = `Mapping flow steps ${msg.n} / ${msg.total}…`; }
  bar.style.width = pct + "%";
  setStatus(label);
});

function render(t) {
  if (!t) return;
  $("summary").style.display = "block";
  $("t-total").textContent = t.total; $("t-on").textContent = t.on; $("t-off").textContent = t.off;
  $("t-err").textContent = t.errored; $("t-dorm").textContent = t.dormant;
  $("t-never").textContent = t.neverEnrolled; $("t-dup").textContent = t.dupClusters;
  if (PORTAL === FFA.ACCEPTANCE.portal) {
    const chk = FFA.checkAcceptance(t), fails = chk.structural.filter((x) => !x.ok), el = $("accept");
    el.style.display = "block";
    if (fails.length) { el.className = "bad"; el.textContent = "⚠ Structural mismatch: " + fails.map((f) => `${f.field} ${f.got}≠${f.want}`).join(", "); }
    else { el.className = "ok"; el.textContent = "✓ Structural totals match the 545075 oracle (229 / 134 / 95)."; }
  }
}
function busy(on) {
  BUSY = on; $("run").disabled = on;
  $("bar").style.display = on ? "block" : $("bar").style.display;
  if (on) { $("bar").firstElementChild.style.width = "0%"; $("accept").style.display = "none"; }
}
$("run").addEventListener("click", async () => {
  if (BUSY) return;
  if (!PORTAL || !TAB_ID) return setStatus("Open a logged-in HubSpot tab, then reopen this.");
  busy(true); setStatus("Starting…");
  const modules = {
    lists: $("m-lists").checked, properties: $("m-props").checked, propertiesFill: $("m-propfill").checked,
    forms: $("m-forms").checked, flowmaps: $("m-flows").checked
  };
  try {
    const resp = await chrome.tabs.sendMessage(TAB_ID, { type: "FFA_RUN_AUDIT", portalId: PORTAL, modules });
    if (!resp) throw new Error("No response — reload the HubSpot tab and retry.");
    if (resp.busy) { setStatus("A run is already going in this tab — let it finish (it downloads automatically)."); return; }
    if (resp.error) throw new Error(resp.error);
    render(resp.totals);
    $("bar").firstElementChild.style.width = "100%";
    setStatus(`Done — Excel + CSV downloaded (${resp.totals.total} workflows).`);
  } catch (e) {
    const m = (e && e.message) || String(e);
    setStatus(/Could not establish connection|Receiving end/.test(m) ? "Reload the HubSpot tab, then retry." : "Error: " + m);
  } finally { busy(false); }
});
