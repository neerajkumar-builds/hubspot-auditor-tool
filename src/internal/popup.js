// Thin popup. Session run is executed by the content-script engine (survives popup close);
// the token fallback runs here. Attaches nothing global.
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
    // if a run is already in flight in this tab (popup was closed mid-run), reflect it
    try {
      const st = await chrome.tabs.sendMessage(TAB_ID, { type: "FFA_STATUS" });
      if (st && st.running) { busy(true); setStatus("Audit already running in this tab — it'll finish and download automatically."); return; }
    } catch (e) { /* content script not loaded yet */ }
    // restore last run for this portal if present
    const { ffaLastRun } = await chrome.storage.local.get("ffaLastRun");
    if (ffaLastRun && ffaLastRun.portal === PORTAL) { render(ffaLastRun.totals); setStatus("Last run restored."); }
  } catch (e) { $("portal").textContent = "unknown"; }
})();

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
    const chk = FFA.checkAcceptance(t);
    const fails = chk.structural.filter((x) => !x.ok);
    const el = $("accept"); el.style.display = "block";
    if (fails.length) { el.className = "bad"; el.textContent = "⚠ Structural mismatch: " + fails.map((f) => `${f.field} ${f.got}≠${f.want}`).join(", "); }
    else { el.className = "ok"; el.textContent = "✓ Structural totals match the 545075 oracle (229 / 134 / 95)."; }
  }
}

function busy(on) {
  BUSY = on; $("run").disabled = on;
  $("bar").style.display = on ? "block" : $("bar").style.display;
  if (on) { $("bar").firstElementChild.style.width = "0%"; $("accept").style.display = "none"; }
}

// SESSION — delegate to the content-script engine (it fetches, builds, downloads).
$("run").addEventListener("click", async () => {
  if (BUSY) return;
  if (!PORTAL || !TAB_ID) return setStatus("Open a logged-in HubSpot tab, then reopen this.");
  busy(true); setStatus("Starting…");
  const modules = {
    lists: $("m-lists").checked, properties: $("m-props").checked,
    propertiesFill: $("m-propfill").checked,
    forms: $("m-forms").checked, flowmaps: $("m-flows").checked
  };
  try {
    const resp = await chrome.tabs.sendMessage(TAB_ID, { type: "FFA_RUN_AUDIT", portalId: PORTAL, modules });
    if (!resp) throw new Error("No response — reload the HubSpot tab (so the engine loads) and retry.");
    if (resp.busy) { setStatus("A run is already going in this tab — let it finish (it downloads automatically)."); return; }
    if (resp.error) throw new Error(resp.error);
    render(resp.totals);
    $("bar").firstElementChild.style.width = "100%";
    setStatus(`Done — Excel + CSV downloaded (${resp.totals.total} workflows).`);
  } catch (e) {
    const m = (e && e.message) || String(e);
    setStatus(/Could not establish connection|Receiving end/.test(m) ? "Reload the HubSpot tab (so the engine loads), then retry." : "Error: " + m);
  } finally { busy(false); }
});
