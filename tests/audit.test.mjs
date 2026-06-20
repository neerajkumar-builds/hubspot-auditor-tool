// Validation harness — pure Node, synthetic fixtures, zero dependencies.
// Loads the real core engine (src/core/*.js) and asserts the diagnostic rules, the
// session-row mapping, each audit module's flags, the lead-validation rules, and that the
// xlsx writer emits a valid (PK-zip) workbook. Run: `npm test` (builds first) or
// `node tests/audit.test.mjs`. Full oracle-parity (229/134/95/14/111/10 on a real portal)
// is validated live, not here — this proves the logic on controlled inputs.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const CORE = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "core");
// Load a first-party IIFE module file into a sandboxed VM context (the modules attach to
// window.FFA). Using node:vm rather than new Function — proper sandbox, no injection surface.
const load = (f, ctx) => vm.runInContext(readFileSync(join(CORE, f), "utf8"), ctx, { filename: f });

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("  ✗ " + name); } };
const section = (s) => console.log("\n" + s);

// ---- sandbox: a fake window + per-test fetch stub ----
function freshFFA(fetchStub) {
  const scope = { TextEncoder, Uint8Array, URL, Date, console, setTimeout, Blob: function () {} };
  scope.window = scope; scope.globalThis = scope; scope.FFA = {};
  scope.fetch = fetchStub || (async () => ({ ok: false, status: 0, json: async () => ({}) }));
  vm.createContext(scope);
  for (const f of ["config.js", "diagnostics.js", "csv.js", "xlsx.js"]) load(f, scope);
  return scope;
}
const mkResp = (j) => ({ ok: true, status: 200, json: async () => j });

// ---- 1. diagnostics rules ----
section("diagnostics");
{
  const s = freshFFA();
  const rows = [
    { name: "A", status: "ON", object_type: "Contact", description: "send welcome email", enrolled_7d: 5, currently_enrolled: 1, total_enrolled: 100, active_issues: 0 },
    { name: "B", status: "ON", object_type: "Contact", description: "dormant flow idle", enrolled_7d: 0, currently_enrolled: 0, total_enrolled: 50, active_issues: 1 },
    { name: "C", status: "ON", object_type: "Deal", description: "never enrolled anyone here", enrolled_7d: 0, currently_enrolled: 0, total_enrolled: 0, active_issues: 0 },
    { name: "D", status: "OFF", object_type: "Deal", description: "switched off", enrolled_7d: 0, currently_enrolled: 0, total_enrolled: 9, active_issues: 0 },
    { name: "send welcome email", status: "ON", object_type: "Contact", description: "send welcome email", enrolled_7d: 2, currently_enrolled: 0, total_enrolled: 20, active_issues: 0 }
  ];
  const t = s.FFA.computeDiagnostics(rows).totals;
  ok("total = 5", t.total === 5);
  ok("on = 4", t.on === 4);
  ok("off = 1", t.off === 1);
  ok("errored = 1 (active_issues>0)", t.errored === 1);
  ok("dormant = 2 (B + C: on, 7d=0, curr=0)", t.dormant === 2);
  ok("neverEnrolled = 1 (C)", t.neverEnrolled === 1);
  ok("dupClusters >= 1 (A ~ duplicate desc)", t.dupClusters >= 1);
  const a = s.FFA.checkAcceptance({ total: 229, on: 134, off: 95, errored: 14, dormant: 111, neverEnrolled: 10, dupClusters: 33 });
  ok("acceptance structural all-ok on oracle numbers", a.structural.every((x) => x.ok));
}

// ---- 2. session row mapping ----
section("mapSessionRow");
{
  const s = freshFFA();
  const r = s.FFA.mapSessionRow({
    objectId: "999", hs_name: "Flow X", hs_enabled: "true", hs_object_type_id: "0-3",
    hs_enrollment_trigger: "LIST", hs_re_enrollment_enabled: "true", hs_total_enrolled: "10",
    hs_current_active_issue_count: "2", hs_source_app: "WORKFLOWS_APP", hs_flow_id: "555",
    hs_flow_created_by_user_id: "u1", hs_flow_created_at: "1700000000000"
  }, "545075", { u1: "Jane Owner" });
  ok("status ON", r.status === "ON");
  ok("object 0-3 -> Deal", r.object_type === "Deal");
  ok("trigger LIST -> 'List membership'", r.trigger_type === "List membership");
  ok("reenrollment Yes", r.reenrollment === "Yes");
  ok("active_issues numeric", r.active_issues === 2);
  ok("owner resolved", r.created_by === "Jane Owner");
  ok("url uses hs_flow_id", /\/flow\/555\/edit$/.test(r.url));
  ok("id = objectId", r.id === "999");
  const u = s.FFA.mapSessionRow({ objectId: "1", hs_object_type_id: "0-999", hs_enabled: "false" }, "p", {});
  ok("unmapped objectType passes through", u.object_type === "0-999");
  ok("unresolved owner -> blank", u.created_by === "");
}

// ---- 3. xlsx writer emits a valid workbook ----
section("xlsx writer");
{
  const s = freshFFA();
  const rows = [{ name: "W", status: "ON", object_type: "Contact", flow_type: "workflow", trigger_type: "List membership", reenrollment: "No", description: "d", total_enrolled: 1, enrolled_7d: 0, unique_enrolled: 1, currently_enrolled: 0, active_issues: 0, created_in: "Workflows tool", created_on: "2025-01-01", created_by: "", updated_on: "2025-01-02", updated_by: "", id: "1", url: "https://x/flow/1/edit" }];
  const bytes = s.FFA.buildWorkbookBytes(rows, { portal: "545075", date: "2026-06-21" });
  ok("xlsx is a Uint8Array", bytes instanceof Uint8Array);
  ok("xlsx non-trivial size", bytes.length > 2000);
  ok("xlsx starts with PK zip magic", bytes[0] === 0x50 && bytes[1] === 0x4b);
  const csv = s.FFA.toCSV(rows);
  ok("csv header matches COLUMNS", csv.split("\n")[0] === s.FFA.COLUMNS.join(","));
}

// ---- 4. audit modules (stubbed fetch) ----
section("audit modules");
{
  // properties + fill-rate
  const s = freshFFA(async (u) => {
    u = String(u);
    if (u.includes("/properties/v4/")) return mkResp([
      { property: { name: "cf_used", label: "Used", type: "string", createdUserId: 1 } },
      { property: { name: "cf_dead", label: "Dead", type: "string", createdUserId: 2 } }
    ]);
    if (u.includes("/crm-search/report")) return mkResp({ count: 100, aggregations: { a0: [{ key: "__FFA_MISSING__", count: 10 }], a1: [{ key: "__FFA_MISSING__", count: 100 }] } });
    return mkResp({});
  });
  load("audit-properties.js", s);
  const res = await s.FFA.auditProperties({ origin: "https://app.hubspot.com", portalId: "p", headers: {}, objectTypes: [["0-1", "Contact"]], fillRate: true });
  ok("properties: 2 custom", res.model.summary[0].custom === 2);
  ok("properties: 1 never-used (cf_dead, filled 0)", res.model.summary[0].neverUsed === 1);
  ok("properties: cf_used filled=90", res.model.custom.find((x) => x.name === "cf_used").records === 90);
  ok("properties: Properties sheet", res.sheet.name === "Properties");
}
{
  const s = freshFFA(async () => mkResp({ offset: 2, hasMore: false, lists: [
    { name: "Empty", processingType: "MANUAL", objectTypeId: "0-1", additionalProperties: { hs_list_size: "0", hs_list_reference_count: "0" } },
    { name: "Used", processingType: "DYNAMIC", objectTypeId: "0-1", additionalProperties: { hs_list_size: "9", hs_list_reference_count: "2" } }
  ] }));
  load("audit-lists.js", s);
  const res = await s.FFA.auditLists({ origin: "x", portalId: "p", headers: {} });
  ok("lists: total 2", res.model.summary.total === 2);
  ok("lists: 1 empty", res.model.summary.empty === 1);
  ok("lists: Lists sheet", res.sheet.name === "Lists");
}
{
  const now = Date.parse("2026-06-21T00:00:00Z"); const yr = 365 * 864e5; let call = 0;
  const s = freshFFA(async () => { call++; return mkResp(call === 1 ? [
    { name: "Fresh", formType: "HUBSPOT", isPublished: true, updatedAt: now - 30 * 864e5, formFieldGroups: [{ fields: [{}] }] },
    { name: "Stale", formType: "HUBSPOT", isPublished: true, updatedAt: now - 2 * yr, formFieldGroups: [] },
    { name: "Draft", formType: "MEETING", isPublished: false, updatedAt: now, formFieldGroups: [] }
  ] : []); });
  load("audit-forms.js", s);
  const res = await s.FFA.auditForms({ origin: "x", portalId: "p", headers: {}, now });
  ok("forms: total 3", res.model.summary.total === 3);
  ok("forms: 1 unpublished", res.model.summary.unpublished === 1);
  ok("forms: 1 stale", res.model.summary.stale === 1);
}
{
  const ACTS = { "100": [{ actionTypeId: "0-1", fields: { delta: 1, time_unit: "DAYS" } }, { actionTypeId: "0-5", fields: { property_name: "lifecyclestage" } }], "200": [{ actionTypeId: "0-5", fields: { property_name: "lifecyclestage" } }] };
  const s = freshFFA(async (u) => { const m = String(u).match(/\/flows\/(\d+)/); return mkResp({ actions: ACTS[m && m[1]] || [] }); });
  load("audit-flowmaps.js", s);
  const rows = [
    { name: "F1", status: "ON", url: "https://app.hubspot.com/workflows/p/platform/flow/100/edit" },
    { name: "F2", status: "ON", url: "https://app.hubspot.com/workflows/p/platform/flow/200/edit" },
    { name: "F3", status: "OFF", url: "https://app.hubspot.com/workflows/p/platform/flow/300/edit" }
  ];
  const res = await s.FFA.auditFlows({ origin: "x", portalId: "p", headers: {}, rows });
  ok("flowmaps: scanned 2 active only", res.model.scanned === 2);
  ok("flowmaps: step label 'Delay 1 days'", res.model.flows[0].steps[0] === "Delay 1 days");
  ok("flowmaps: set-property step", res.model.flows[0].steps[1] === "Set property: lifecyclestage");
  ok("conflicts: lifecyclestage written by 2 flows", res.model.conflicts.length === 1 && res.model.conflicts[0].flows.length === 2);
  ok("flowmaps: 2 sheets (maps + conflicts)", res.sheets.length === 2);
}

// ---- 5. lead validation rules (mirror of the gate + n8n filter) ----
section("lead validation");
{
  const s = freshFFA();
  // reuse the disposable/junk lists shipped in the example config
  const cfg = readFileSync(join(CORE, "..", "external", "config-external.example.js"), "utf8");
  vm.runInContext(cfg, s, { filename: "config-external.example.js" });
  const DIS = s.FFA.LEAD.disposableDomains, JUNK = s.FFA.LEAD.junkValues;
  const isJunk = (v) => { const x = String(v || "").toLowerCase().trim(); return !!x && JUNK.some((k) => x === k || x.startsWith(k)); };
  const valid = (email, name, company) => {
    const e = email.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e)) return false;
    const [local, domain] = [e.split("@")[0], e.split("@")[1] || ""];
    if (DIS.indexOf(domain) !== -1) return false;
    if (isJunk(local) || isJunk(name) || isJunk(company)) return false;
    if (name.replace(/\s/g, "").length < 2) return false;
    if (company.length < 2) return false;
    return true;
  };
  ok("rejects test@test.com", !valid("test@test.com", "test", "test"));
  ok("rejects disposable mailinator", !valid("a@mailinator.com", "Jane Doe", "Acme"));
  ok("rejects junk local on real domain", !valid("test@gmail.com", "Jane", "Acme"));
  ok("allows real gmail", valid("jane@gmail.com", "Jane Doe", "Acme Co"));
  ok("allows business email", valid("neeraj@fullfunnel.co", "Neeraj Kumar", "FullFunnel"));
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
