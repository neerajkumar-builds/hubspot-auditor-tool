// Optional audit module: PROPERTIES (custom-field hygiene).
// Discovered: GET {origin}/api/properties/v4/{objectTypeId} -> array of { property: {...} }.
// Custom = property.createdUserId != null.
// Cheap flags (always): custom sprawl, undocumented (no description), duplicate labels.
// Opt-in DEEP SCAN (ctx.fillRate): records-with-value per custom prop + "Never used" flag,
//   via the crm-search/report MISSING aggregation (batched -> filled = total - missing).
//   Validated exact vs HAS_PROPERTY counts. Self-contained; never throws.
(function () {
  const FFA = (typeof window !== "undefined" ? window : globalThis).FFA = (typeof window !== "undefined" ? window : globalThis).FFA || {};
  const DEFAULT_OBJECTS = [["0-1", "Contact"], ["0-2", "Company"], ["0-3", "Deal"], ["0-5", "Ticket"], ["0-136", "Lead"]];
  const MV = "__FFA_MISSING__";

  // Bulk fill counts for an object's properties: { total, filledByName }.
  async function fillCounts(origin, q, headers, ot, names) {
    const filledByName = {}; let total = 0;
    const BATCH = 10; // crm-search/report caps at 10 aggregations per call
    for (let i = 0; i < names.length; i += BATCH) {
      const batch = names.slice(i, i + BATCH);
      const aggs = batch.map((p, j) => ({ name: "a" + j, type: "MISSING", property: p, missingValue: MV, size: 1 }));
      try {
        const r = await fetch(`${origin}/api/crm-search/report?${q}`, {
          method: "POST", credentials: "include", headers,
          body: JSON.stringify({ objectTypeId: ot, query: "", filterGroups: [], aggregations: aggs })
        });
        if (!r.ok) continue;
        const j = await r.json();
        if (j.count != null) total = j.count;
        batch.forEach((p, k) => {
          const a = j.aggregations && j.aggregations["a" + k];
          const miss = (a && a[0] && a[0].count) || 0;
          filledByName[p] = Math.max(0, total - miss);
        });
      } catch (e) { /* batch skipped */ }
    }
    return { total, filledByName };
  }

  FFA.auditProperties = async function (ctx) {
    const origin = ctx.origin, portalId = ctx.portalId, headers = ctx.headers;
    const OT = ctx.objectTypes || DEFAULT_OBJECTS;
    const q = "portalId=" + encodeURIComponent(portalId) + "&clienttimeout=14000";
    const fillRan = !!ctx.fillRate;
    const summary = [], custom = [], dupClusters = [];

    for (let i = 0; i < OT.length; i++) {
      const ot = OT[i][0], label = OT[i][1];
      let arr = null;
      try {
        const r = await fetch(`${origin}/api/properties/v4/${ot}?${q}`, { credentials: "include", headers });
        if (!r.ok) continue;
        arr = await r.json();
      } catch (e) { continue; }
      const ps = (arr || []).map((x) => x.property || x).filter((p) => p && !p.deleted);
      const cs = ps.filter((p) => p.createdUserId != null);
      const noDesc = cs.filter((p) => !p.description || !String(p.description).trim());
      const byLabel = {};
      cs.forEach((p) => { const k = String(p.label || "").toLowerCase().trim(); if (k) (byLabel[k] = byLabel[k] || []).push(p); });
      const dups = Object.keys(byLabel).map((k) => byLabel[k]).filter((a) => a.length > 1);
      dups.forEach((a) => dupClusters.push({ object: label, label: a[0].label, names: a.map((p) => p.name) }));

      let filled = null;
      if (fillRan && cs.length) {
        if (ctx.onProgress) ctx.onProgress(i, OT.length);
        filled = (await fillCounts(origin, q, headers, ot, cs.map((p) => p.name))).filledByName;
      }
      let neverUsed = 0;
      cs.forEach((p) => {
        const rec = filled ? (filled[p.name] != null ? filled[p.name] : null) : null;
        const never = rec === 0;
        if (never) neverUsed++;
        custom.push({
          object: label, name: p.name, label: p.label || "", group: p.groupName || "", type: p.type || "",
          hasDesc: !!(p.description && String(p.description).trim()),
          created: p.createdAt ? new Date(Number(p.createdAt)).toISOString().slice(0, 10) : "",
          records: rec, neverUsed: never
        });
      });
      summary.push({ object: label, total: ps.length, custom: cs.length, noDescription: noDesc.length, dupGroups: dups.length, neverUsed: fillRan ? neverUsed : null });
    }

    const model = { summary, custom, dupClusters, fillRan };
    return { model, sheet: buildSheet(model, portalId) };
  };

  function buildSheet(model, portalId) {
    const xl = FFA.xl, S = xl.S, N = xl.N, fill = model.fillRan;
    const rows = [];
    rows.push([]);
    rows.push(["", S("Property Audit — FullFunnel", xl.TITLE)]);
    rows.push(["", S(`Portal ${portalId} · custom-field hygiene across core objects`, xl.GREY)]);
    rows.push([]);
    rows.push(["", S("Summary by object", xl.BOLD)]);
    const sumHead = ["", S("Object", 1), S("Total props", 1), S("Custom", 1), S("No description", 1), S("Dup-label groups", 1)];
    if (fill) sumHead.push(S("Never used", 1));
    rows.push(sumHead);
    model.summary.forEach((s) => {
      const r = ["", s.object, N(s.total), N(s.custom), N(s.noDescription), N(s.dupGroups)];
      if (fill) r.push(N(s.neverUsed || 0));
      rows.push(r);
    });
    rows.push([]);
    if (model.dupClusters.length) {
      rows.push(["", S("Duplicate-label custom properties — consolidate", xl.BOLD)]);
      rows.push(["", S("Object", 1), S("Label", 1), S("Property names", 1)]);
      model.dupClusters.forEach((d) => rows.push(["", d.object, d.label, d.names.join(", ")]));
      rows.push([]);
    }
    const heading = fill ? "Custom properties (never-used first = delete candidates)" : "Custom properties (review for cleanup / documentation)";
    rows.push(["", S(heading, xl.BOLD)]);
    const head = ["", S("Object", 1), S("Name", 1), S("Label", 1), S("Group", 1), S("Type", 1), S("Documented", 1)];
    if (fill) head.push(S("Records w/ value", 1), S("Used?", 1));
    head.push(S("Created", 1));
    rows.push(head);
    const list = fill ? model.custom.slice().sort((a, b) => (a.neverUsed === b.neverUsed ? 0 : (a.neverUsed ? -1 : 1)) || ((a.records || 0) - (b.records || 0))) : model.custom;
    list.forEach((p) => {
      const r = ["", p.object, p.name, p.label, p.group, p.type, p.hasDesc ? "Yes" : "—"];
      if (fill) r.push(p.records == null ? "?" : N(p.records), p.neverUsed ? "NEVER USED" : "yes");
      r.push(p.created);
      rows.push(r);
    });
    const cols = fill ? [3, 14, 32, 30, 18, 13, 12, 14, 12, 12] : [3, 14, 34, 34, 22, 14, 14, 12];
    return { name: "Properties", rows, cols: cols };
  }
})();
