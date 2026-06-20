// Optional audit module: LISTS (list sprawl).
// Discovered: POST {origin}/api/crm/v3/lists/search  body { count, offset, query } ->
//   { offset, hasMore, lists:[ { listId, name, processingType, objectTypeId, createdAt,
//     additionalProperties:{ hs_list_size, hs_list_reference_count, ... } } ] }
// Flags: empty (size 0) and unused (reference_count 0 = nothing points at it).
// Self-contained; never throws (a failure returns an empty result).
(function () {
  const FFA = (typeof window !== "undefined" ? window : globalThis).FFA = (typeof window !== "undefined" ? window : globalThis).FFA || {};
  const TYPE = { MANUAL: "Static", DYNAMIC: "Active (dynamic)", SNAPSHOT: "Snapshot" };

  FFA.auditLists = async function (ctx) {
    const origin = ctx.origin, portalId = ctx.portalId, headers = ctx.headers;
    const q = "portalId=" + encodeURIComponent(portalId) + "&clienttimeout=14000";
    const url = `${origin}/api/crm/v3/lists/search?${q}`;
    const num = (l, k) => { const v = l.additionalProperties && l.additionalProperties[k]; return v == null ? 0 : Number(v); };
    const day = (iso) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : d.toISOString().slice(0, 10); };

    let all = [], offset = 0, guard = 0;
    try {
      do {
        const r = await fetch(url, { method: "POST", credentials: "include", headers, body: JSON.stringify({ count: 250, offset: offset, query: "" }) });
        if (!r.ok) break;
        const j = await r.json();
        (j.lists || []).forEach((l) => all.push(l));
        offset = j.offset; guard++;
        if (!j.hasMore || guard > 40) break;
      } while (true);
    } catch (e) { /* best-effort */ }

    const lists = all.map((l) => {
      const size = num(l, "hs_list_size"), refs = num(l, "hs_list_reference_count");
      const flag = size === 0 ? "Empty" : (refs === 0 ? "Unused (no references)" : "");
      return {
        name: l.name || "", type: TYPE[l.processingType] || l.processingType || "",
        object: FFA.OBJECT_TYPE_MAP[l.objectTypeId] || l.objectTypeId || "", size: size, refs: refs,
        created: day(l.createdAt), updated: day(l.updatedAt), flag: flag
      };
    });
    const summary = {
      total: lists.length,
      dynamic: lists.filter((l) => l.type === TYPE.DYNAMIC).length,
      static: lists.filter((l) => l.type === TYPE.MANUAL).length,
      snapshot: lists.filter((l) => l.type === TYPE.SNAPSHOT).length,
      empty: lists.filter((l) => l.flag === "Empty").length,
      unused: lists.filter((l) => l.flag === "Unused (no references)").length
    };
    const model = { summary, lists };
    return { model, sheet: buildSheet(model, portalId) };
  };

  function buildSheet(model, portalId) {
    const xl = FFA.xl, S = xl.S, N = xl.N, s = model.summary;
    const rows = [];
    rows.push([]);
    rows.push(["", S("List Audit — FullFunnel", xl.TITLE)]);
    rows.push(["", S(`Portal ${portalId} · ${s.total} lists · ${s.unused} unused · ${s.empty} empty`, xl.GREY)]);
    rows.push([]);
    rows.push(["", S("Summary", xl.BOLD)]);
    rows.push(["", S("Total lists", 1), S("Active/dynamic", 1), S("Static", 1), S("Snapshot", 1), S("Empty", 1), S("Unused (no refs)", 1)]);
    rows.push(["", N(s.total), N(s.dynamic), N(s.static), N(s.snapshot), N(s.empty), N(s.unused)]);
    rows.push([]);
    rows.push(["", S("Lists — cleanup candidates first", xl.BOLD)]);
    rows.push(["", S("List", 1), S("Type", 1), S("Object", 1), S("Size", 1), S("References", 1), S("Flag", 1), S("Created", 1)]);
    // empty + unused first, then the rest
    const order = { "Empty": 0, "Unused (no references)": 1, "": 2 };
    model.lists.slice().sort((a, b) => (order[a.flag] - order[b.flag]) || (a.refs - b.refs) || (a.size - b.size))
      .forEach((l) => rows.push(["", l.name, l.type, l.object, N(l.size), N(l.refs), l.flag, l.created]));
    return { name: "Lists", rows, cols: [3, 44, 16, 12, 9, 12, 22, 12] };
  }
})();
