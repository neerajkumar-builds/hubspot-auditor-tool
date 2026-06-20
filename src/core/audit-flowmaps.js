// Optional audit module: FLOW STEP-MAPS + CONFLICT DETECTION (heaviest — one fetch per flow).
// Discovered: GET {origin}/api/automation/v4/flows/{flowId} -> { actions:[ { actionTypeId,
//   type, fields, connection } ], startActionId, ... }. Works for app + classic flows.
// Action vocab (545075): 0-1 delay, 0-4 send email, 0-5 set property(property_name),
//   0-3 create task, 0-23 internal email, 1-* slack/webinar, type *BRANCH* = if/then.
// B1: per active flow, a readable step list. B2: properties set by >1 ACTIVE flow = race risk.
// Opt-in + throttled; only ACTIVE flows are fetched. Self-contained; never throws.
(function () {
  const FFA = (typeof window !== "undefined" ? window : globalThis).FFA = (typeof window !== "undefined" ? window : globalThis).FFA || {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function labelAction(a) {
    const f = a.fields || {};
    if (a.type && /BRANCH/.test(a.type)) { const n = (a.listBranches || a.filterBranches || []).length; return "If / then branch" + (n ? ` (${n} paths)` : ""); }
    if (f.delta != null && f.time_unit) return `Delay ${f.delta} ${String(f.time_unit).toLowerCase()}`;
    if (f.property_name) return `Set property: ${f.property_name}`;
    if (f.content_id) return "Send marketing email";
    if (f.email_content_id) return "Send internal email";
    if (f.slackChannelIds || f.slackUserIds) return "Send Slack notification";
    if (f.task_type || f.subject) return "Create task" + (f.subject ? `: ${String(f.subject).slice(0, 40)}` : "");
    if (f.webinarId) return "Add to webinar";
    if (f.list_id || f.static_list_id) return "Add/remove from list";
    return "Action " + (a.actionTypeId || a.type || "?");
  }
  const flowIdOf = (row) => { const m = String(row.url || "").match(/\/flow\/(\d+)\//); return m ? m[1] : null; };

  FFA.auditFlows = async function (ctx) {
    const origin = ctx.origin, portalId = ctx.portalId, headers = ctx.headers;
    const q = "portalId=" + encodeURIComponent(portalId) + "&clienttimeout=14000";
    const active = (ctx.rows || []).filter((r) => String(r.status).toUpperCase() === "ON" && flowIdOf(r));
    const cap = ctx.cap || active.length;
    const targets = active.slice(0, cap);

    const flows = [];            // { name, steps:[label], setProps:[propName] }
    const propWriters = {};      // propName -> [flowName]
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i], id = flowIdOf(row);
      let acts = [];
      try {
        const r = await fetch(`${origin}/api/automation/v4/flows/${id}?${q}`, { credentials: "include", headers });
        if (r.ok) { const j = await r.json(); acts = j.actions || []; }
      } catch (e) { /* skip this flow */ }
      const steps = acts.map(labelAction);
      const setProps = acts.map((a) => a.fields && a.fields.property_name).filter(Boolean);
      setProps.forEach((p) => { (propWriters[p] = propWriters[p] || []).push(row.name); });
      flows.push({ name: row.name, status: row.status, steps: steps, setProps: setProps });
      if (ctx.onProgress) ctx.onProgress(i + 1, targets.length);
      if (i < targets.length - 1) await sleep(FFA.RATE_SLEEP_MS || 250);
    }

    const conflicts = Object.keys(propWriters)
      .map((p) => ({ property: p, flows: Array.from(new Set(propWriters[p])) }))
      .filter((c) => c.flows.length > 1)
      .sort((a, b) => b.flows.length - a.flows.length);

    const model = { flows, conflicts, scanned: targets.length, activeTotal: active.length };
    return { model, sheets: [buildMapSheet(model, portalId), buildConflictSheet(model, portalId)] };
  };

  function buildMapSheet(model, portalId) {
    const xl = FFA.xl, S = xl.S, N = xl.N;
    const rows = [];
    rows.push([]);
    rows.push(["", S("Flow Step-Maps — FullFunnel", xl.TITLE)]);
    rows.push(["", S(`Portal ${portalId} · what each of ${model.scanned} active flows actually does`, xl.GREY)]);
    rows.push([]);
    rows.push(["", S("Flow", 1), S("Status", 1), S("Step #", 1), S("Step", 1)]);
    model.flows.forEach((fl) => {
      if (!fl.steps.length) { rows.push(["", S(fl.name, xl.BOLD), fl.status, "", S("(no actions)", xl.GREY)]); return; }
      fl.steps.forEach((st, idx) => rows.push(["", idx === 0 ? S(fl.name, xl.BOLD) : "", idx === 0 ? fl.status : "", N(idx + 1), st]));
    });
    return { name: "Flow Maps", rows, cols: [3, 42, 9, 8, 56] };
  }

  function buildConflictSheet(model, portalId) {
    const xl = FFA.xl, S = xl.S, N = xl.N;
    const rows = [];
    rows.push([]);
    rows.push(["", S("Conflicts — FullFunnel", xl.TITLE)]);
    rows.push(["", S(`Portal ${portalId} · properties written by more than one ACTIVE flow (possible races)`, xl.GREY)]);
    rows.push([]);
    if (!model.conflicts.length) {
      rows.push(["", S("No property-write conflicts among active flows. ✓", xl.BOLD)]);
    } else {
      rows.push(["", S("Property", 1), S("# active flows", 1), S("Flows writing it", 1)]);
      model.conflicts.forEach((c) => rows.push(["", c.property, N(c.flows.length), c.flows.join("; ")]));
    }
    return { name: "Conflicts", rows, cols: [3, 32, 14, 80] };
  }
})();
