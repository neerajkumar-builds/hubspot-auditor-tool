// Runs on *.hubspot.com (ISOLATED world). This is the AUDIT ENGINE — it has the
// authenticated session (cookies + CSRF) AND the FFA modules (config/diagnostics/csv/xlsx
// are injected alongside it). Because it lives in the tab, the run survives the popup closing.
//
// DISCOVERED CONTRACT (portal 545075, NA):
//   POST {origin}/api/crm-search/search   body { objectTypeId:"0-44", count, offset, sorts,
//        requestOptions:{ properties:[...] } }   header X-HubSpot-CSRF-hubspotapi: <cookie>
//   GET  {origin}/api/crm/v3/owners        -> userId/id -> name (best-effort owner resolution)

(function () {
  if (window.__ffaInstalled) return;
  window.__ffaInstalled = true;

  // --- discovery sniffer (kept for re-discovery on other portals / future UI changes) ---
  window.__ffaSniff = function (on) {
    if (!on) { window.__ffaSniffOn = false; return "sniff off"; }
    window.__ffaSniffOn = true;
    const RE = /automation|workflow|flow|0-44|crm-search|crm\/v[34]\/objects|crm-object|insights|enrollment/i;
    const log = (u, m) => { if (window.__ffaSniffOn && u && RE.test(u)) console.log("[FFA candidate]", m || "GET", u); };
    const of = window.fetch;
    window.fetch = function (...a) { try { log(typeof a[0] === "string" ? a[0] : a[0].url, (a[1] && a[1].method) || "GET"); } catch (e) {} return of.apply(this, a); };
    const oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) { try { log(u, m); } catch (e) {} return oo.apply(this, arguments); };
    return "FFA sniff ON — reload the list and watch for [FFA candidate].";
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function readCookie(name) {
    const esc = name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&");
    const m = document.cookie.match(new RegExp("(?:^|; )" + esc + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  const progress = (phase, n, total) => { try { chrome.runtime.sendMessage({ type: "FFA_PROGRESS", phase, n, total }); } catch (e) {} };

  // Best-effort owner map: { <userId|ownerId>: "Name" }. Never throws (resolution is optional).
  async function fetchOwners(spec, portalId, headers) {
    const map = {};
    try {
      let after = null, guard = 0;
      do {
        const url = `${location.origin}${spec.ownersPath}?portalId=${encodeURIComponent(portalId)}&clienttimeout=14000&limit=500` + (after ? `&after=${after}` : "");
        const res = await fetch(url, { credentials: "include", headers });
        if (!res.ok) break;
        const j = await res.json();
        (j.results || []).forEach((o) => {
          const nm = ((o.firstName || "") + " " + (o.lastName || "")).trim() || o.email || "";
          if (!nm) return;
          if (o.userId) map[String(o.userId)] = nm;
          if (o.id) map[String(o.id)] = nm;
        });
        after = j.paging && j.paging.next && j.paging.next.after; guard++;
      } while (after && guard < 12);
    } catch (e) { /* resolution is best-effort */ }
    return map;
  }

  async function fetchFlows(spec, portalId, headers) {
    const url = `${location.origin}${spec.searchPath}?portalId=${encodeURIComponent(portalId)}&clienttimeout=14000`;
    const seen = new Map();
    let offset = 0, total = null, page = 0;
    do {
      const body = {
        objectTypeId: spec.objectTypeId, count: spec.pageSize, offset,
        query: "", filterGroups: [], sorts: spec.sorts || [],
        requestOptions: { properties: spec.properties }
      };
      const res = await fetch(url, { method: "POST", credentials: "include", headers, body: JSON.stringify(body) });
      if (res.status === 401 || res.status === 403) throw new Error("AUTH " + res.status + ": session/CSRF rejected. Reload the HubSpot tab and retry.");
      if (!res.ok) throw new Error("crm-search HTTP " + res.status);
      const j = await res.json();
      total = j.total;
      const batch = j.results || [];
      batch.forEach((o) => {
        const p = o.properties || {}, out = { objectId: String(o.objectId) };
        for (const k in p) out[k] = p[k] ? p[k].value : null;
        seen.set(out.objectId, out);
      });
      offset += spec.pageSize; page++;
      progress("flows", seen.size, total);
      if (!batch.length || page > 200) break;
      if (seen.size < total) await sleep(FFA.RATE_SLEEP_MS);
    } while (seen.size < total);
    return Array.from(seen.values());
  }

  async function runAudit(portalId, modules) {
    const spec = FFA.SESSION;
    const token = readCookie(spec.csrfCookie);
    if (!token) throw new Error("Not logged in: cookie '" + spec.csrfCookie + "' missing. Open/refresh a logged-in HubSpot tab.");
    const headers = { "content-type": "application/json", "accept": "application/json" };
    headers[spec.csrfHeader] = token; // request header only — never logged

    progress("owners", 0, null);
    const ownerMap = await fetchOwners(spec, portalId, headers);
    const raw = await fetchFlows(spec, portalId, headers);
    progress("building", raw.length, raw.length);

    const allRows = raw.map((r) => FFA.mapSessionRow(r, portalId, ownerMap));
    // Match the HubSpot Workflows list: audit the actionable set (excludes external +
    // deleted flows the UI hides); report the extras only as a reconciliation count.
    const part = FFA.partitionActionable(allRows);
    const rows = part.actionable;
    const diag = FFA.computeDiagnostics(rows);
    const meta = { portal: portalId, date: new Date().toISOString().slice(0, 10), extras: part.extras };

    // Optional add-on modules. Each is isolated in try/catch — a failure (missing endpoint,
    // lower tier, API change) is skipped and NEVER aborts the workflow audit.
    const ctx = { origin: location.origin, portalId: portalId, headers: headers, rows: rows };
    const extraSheets = [];
    const mods = modules || {};
    async function runModule(on, phase, fn, collect) {
      if (!on || typeof fn !== "function") return;
      progress(phase, 0, null);
      try { collect(await fn(Object.assign({}, ctx, { onProgress: (n, t) => progress(phase, n, t) }))); }
      catch (e) { /* module skipped */ }
    }
    await runModule(mods.properties || mods.propertiesFill, "properties", (c) => FFA.auditProperties(Object.assign({}, c, { fillRate: !!mods.propertiesFill })), (r) => { if (r && r.sheet) extraSheets.push(r.sheet); });
    await runModule(mods.lists, "lists", FFA.auditLists, (r) => { if (r && r.sheet) extraSheets.push(r.sheet); });
    await runModule(mods.forms, "forms", FFA.auditForms, (r) => { if (r && r.sheet) extraSheets.push(r.sheet); });
    await runModule(mods.flowmaps, "flowmaps", FFA.auditFlows, (r) => { if (r && r.sheets) r.sheets.forEach((s) => extraSheets.push(s)); });

    progress("building", rows.length, rows.length);
    try { FFA.downloadXLSX(FFA.buildWorkbookBytes(rows, meta, extraSheets), `HubSpot_Workflow_Audit_${portalId}.xlsx`); } catch (e) { /* xlsx optional */ }
    FFA.downloadCSV(FFA.toCSV(rows), `hubspot_workflows_${portalId}.csv`);

    const summary = { portal: portalId, totals: diag.totals, modules: Object.keys(mods).filter((k) => mods[k]), ts: Date.now() };
    // storage.local (not .session) — content scripts can't reach session storage by default.
    try { chrome.storage.local.set({ ffaLastRun: summary }); } catch (e) {}
    progress("done", rows.length, rows.length);
    return summary;
  }

  let RUNNING = false; // re-entrancy guard: only one audit per tab at a time

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "FFA_PORTAL_PING") {
      const m = location.href.match(/hubspot\.com\/[^/]+\/(\d+)/);
      sendResponse({ portalId: m ? m[1] : null, href: location.href });
      return true;
    }
    if (msg && msg.type === "FFA_STATUS") {
      sendResponse({ running: RUNNING });   // lets a re-opened popup know a run is in flight
      return true;
    }
    if (msg && msg.type === "FFA_RUN_AUDIT") {
      if (RUNNING) { sendResponse({ busy: true }); return true; }   // ignore double-clicks / concurrent runs
      RUNNING = true;
      runAudit(msg.portalId, msg.modules || {})
        .then((s) => sendResponse(s))
        .catch((e) => sendResponse({ error: String((e && e.message) || e) }))
        .finally(() => { RUNNING = false; });
      return true; // async; the run continues even if the popup closes
    }
    return true;
  });
})();
