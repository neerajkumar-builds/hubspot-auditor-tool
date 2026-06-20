// Optional audit module: FORMS.
// Discovered: GET {origin}/api/forms/v2/forms?limit=250&offset=N -> array of form objects
//   { guid, name, formType, isPublished, createdAt, updatedAt, deletedAt, formFieldGroups }.
// No submission count in this payload (that needs analytics) — so we flag the cheap signals:
// unpublished + stale (not updated in 18 months). Self-contained; never throws.
(function () {
  const FFA = (typeof window !== "undefined" ? window : globalThis).FFA = (typeof window !== "undefined" ? window : globalThis).FFA || {};
  const STALE_MS = 18 * 30 * 24 * 3600 * 1000;

  FFA.auditForms = async function (ctx) {
    const origin = ctx.origin, portalId = ctx.portalId, headers = ctx.headers;
    const q = "portalId=" + encodeURIComponent(portalId) + "&clienttimeout=14000";
    const day = (ms) => { const n = Number(ms); return n ? new Date(n).toISOString().slice(0, 10) : ""; };
    const now = ctx.now || Date.now();

    let all = [], offset = 0, guard = 0;
    try {
      do {
        const r = await fetch(`${origin}/api/forms/v2/forms?limit=250&offset=${offset}&${q}`, { credentials: "include", headers });
        if (!r.ok) break;
        const j = await r.json();
        if (!Array.isArray(j) || !j.length) break;
        all = all.concat(j); offset += 250; guard++;
        if (j.length < 250 || guard > 40) break;
      } while (true);
    } catch (e) { /* best-effort */ }

    const forms = all.filter((f) => !f.deletedAt).map((f) => {
      const fields = (f.formFieldGroups || []).reduce((n, g) => n + ((g.fields || []).length), 0);
      const stale = f.updatedAt && Number(f.updatedAt) < (now - STALE_MS);
      const flag = !f.isPublished ? "Unpublished" : (stale ? "Stale (18mo+)" : "");
      return { name: f.name || "", type: f.formType || "", published: !!f.isPublished, fields: fields, created: day(f.createdAt), updated: day(f.updatedAt), flag: flag };
    });
    const byType = {};
    forms.forEach((f) => byType[f.type || "?"] = (byType[f.type || "?"] || 0) + 1);
    const summary = {
      total: forms.length,
      published: forms.filter((f) => f.published).length,
      unpublished: forms.filter((f) => !f.published).length,
      stale: forms.filter((f) => f.flag === "Stale (18mo+)").length,
      byType: byType
    };
    const model = { summary, forms };
    return { model, sheet: buildSheet(model, portalId) };
  };

  function buildSheet(model, portalId) {
    const xl = FFA.xl, S = xl.S, N = xl.N, s = model.summary;
    const rows = [];
    rows.push([]);
    rows.push(["", S("Form Audit — FullFunnel", xl.TITLE)]);
    rows.push(["", S(`Portal ${portalId} · ${s.total} forms · ${s.unpublished} unpublished · ${s.stale} stale (18mo+)`, xl.GREY)]);
    rows.push([]);
    rows.push(["", S("Summary", xl.BOLD)]);
    rows.push(["", S("Total", 1), S("Published", 1), S("Unpublished", 1), S("Stale (18mo+)", 1)]);
    rows.push(["", N(s.total), N(s.published), N(s.unpublished), N(s.stale)]);
    rows.push([]);
    rows.push(["", S("By type", xl.BOLD)]);
    Object.keys(s.byType).sort((a, b) => s.byType[b] - s.byType[a]).forEach((k) => rows.push(["", k, N(s.byType[k])]));
    rows.push([]);
    rows.push(["", S("Forms — review flagged first", xl.BOLD)]);
    rows.push(["", S("Form", 1), S("Type", 1), S("Published", 1), S("Fields", 1), S("Updated", 1), S("Flag", 1)]);
    const order = { "Unpublished": 0, "Stale (18mo+)": 1, "": 2 };
    model.forms.slice().sort((a, b) => (order[a.flag] - order[b.flag]) || (a.updated < b.updated ? -1 : 1))
      .forEach((f) => rows.push(["", f.name, f.type, f.published ? "Yes" : "No", N(f.fields), f.updated, f.flag]));
    return { name: "Forms", rows, cols: [3, 48, 18, 11, 8, 12, 16] };
  }
})();
