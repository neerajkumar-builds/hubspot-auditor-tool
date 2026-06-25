// Shared constants + mappings. Loaded first (popup AND content script). Attaches to window.FFA.
window.FFA = window.FFA || {};

// Exact CSV schema — must stay byte-for-byte aligned with build_audit.py input.
FFA.COLUMNS = [
  "name", "status", "object_type", "flow_type", "trigger_type", "reenrollment",
  "description", "total_enrolled", "enrolled_7d", "unique_enrolled",
  "currently_enrolled", "active_issues", "created_in", "created_on",
  "created_by", "updated_on", "updated_by", "id", "url"
];

// FullFunnel brand (per Brand Guide, Apr 2025). Electric Blue is the one accent.
FFA.BRAND = {
  name: "FullFunnel",
  accent: "#146DFA",   // Electric Blue
  dark:   "#0A0A0A",   // Black
  light:  "#F9F9F9",   // Light Grey
  white:  "#FFFFFF",
  font:   "'Montserrat', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
};

// HubSpot objectTypeId -> label. Covers types seen on real portals; unknown ids pass through.
FFA.OBJECT_TYPE_MAP = {
  "0-1": "Contact", "0-2": "Company", "0-3": "Deal", "0-5": "Ticket",
  "0-136": "Lead", "0-101": "Commerce Payment", "0-11": "Conversation",
  "0-14": "Quote", "0-115": "User", "0-69": "Subscription", "0-410": "Order",
  "0-422": "Data Privacy Request", "0-162": "Service"
};

// hs_source_app enum -> the "Created In" label.
FFA.SOURCE_APP_MAP = {
  "WORKFLOWS_APP": "Workflows tool",
  "WORKFLOWS_CLASSIC": "Workflows (classic)",
  "DEAL_PIPELINE_SETTINGS": "Deal pipeline settings",
  "FORM_FOLLOWUP_EMAIL": "Form follow-up email",
  "FEEDBACK": "Feedback surveys",
  "FEEDBACK_FOLLOW_UP": "Feedback follow-up",
  "LEAD_AUTOMATION_RULES": "Lead automation rules",
  "FORMS_APP": "Forms",
  "FORECASTING": "Forecasting",
  "PUBLIC_API": "Public API",
  "ADS_FLOW": "Ads",
  "RULESETS_GLOBAL_DATA_PROTECTION": "Data privacy rules",
  "SEQUENCES": "Sequences",
  "CHATFLOWS": "Chatflows"
};

// hs_enrollment_trigger enum -> friendly label.
FFA.TRIGGER_LABEL = {
  "LIST": "List membership", "LIST_MEMBERSHIP": "List membership",
  "EVENT": "Event-based", "EVENT_BASED": "Event-based",
  "NEW": "New", "SCHEDULE": "Scheduled", "FORM_SUBMISSION": "Form submission"
};

// Tunables.
FFA.RATE_SLEEP_MS = 250;        // between paged requests
FFA.DUP_SIMILARITY = 0.6;       // Jaccard threshold for the popup's dup-cluster preview

// Acceptance baseline (portal 545075), re-based v1.1 to the HubSpot Workflows-list definition:
// excludes external (integration-managed) + deleted flows, matching what users see in the UI.
// Structural total/on/off are validated exact; derived figures are point-in-time (see note).
FFA.ACCEPTANCE = {
  portal: "545075",
  total: 214, on: 127, off: 87,
  errored: 14, neverEnrolled: 8
};

// Adapter B (session) request spec — internal crm-search over CRM object 0-44.
// Auth: session cookies + CSRF header from the non-HttpOnly hubspotapi-csrf cookie.
FFA.SESSION = {
  objectTypeId: "0-44",
  pageSize: 100,
  // Stable sort REQUIRED — without it offset paging is non-deterministic (corrupts counts).
  sorts: [{ property: "hs_object_id", order: "ASC" }],
  csrfCookie: "hubspotapi-csrf",
  csrfHeader: "X-HubSpot-CSRF-hubspotapi",
  searchPath: "/api/crm-search/search",
  ownersPath: "/api/crm/v3/owners",   // userId/id -> name (best-effort owner resolution)
  properties: [
    "hs_name", "hs_enabled", "hs_object_type_id", "hs_flow_type",
    "hs_enrollment_trigger", "hs_re_enrollment_enabled", "hs_description",
    "hs_total_enrolled", "hs_7_day_enrollment", "hs_total_unique_contacts_enrolled",
    "hs_currently_enrolled", "hs_current_active_issue_count", "hs_source_app",
    "hs_flow_created_at", "hs_flow_created_by_user_id",
    "hs_flow_updated_at", "hs_flow_updated_by_user_id", "hs_flow_id",
    // v1.1: distinguish what the HubSpot Workflows list shows (excludes external + deleted),
    // and support a stable "stale" signal (last action run date).
    "hs_is_external", "hs_is_deleted", "hs_last_action_execution_date"
  ]
};

// "Stale" threshold (days) for the durable dead-workflow signal — far less volatile than the
// rolling 7-day enrollment count. A flow ON with no action executed in this long is a real
// delete candidate regardless of which day the audit runs.
FFA.STALE_DAYS = 90;

FFA.buildUrl = (portal, id) =>
  `https://app.hubspot.com/workflows/${portal}/platform/flow/${id}/edit`;

// Map one raw session row ({ objectId, hs_*:value }) -> FFA.COLUMNS shape.
// ownerMap: { <userId|ownerId>: "Name" } — best-effort; blank when unresolved.
FFA.mapSessionRow = function (r, portalId, ownerMap) {
  ownerMap = ownerMap || {};
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const day = (ms) => { const n = Number(ms); return n ? new Date(n).toISOString().slice(0, 10) : ""; };
  const owner = (id) => (id && ownerMap[String(id)]) || "";
  const objId = r.hs_object_type_id;
  const trig = r.hs_enrollment_trigger;
  return {
    name: r.hs_name || "",
    status: String(r.hs_enabled) === "true" ? "ON" : "OFF",
    object_type: FFA.OBJECT_TYPE_MAP[objId] || objId || "",
    flow_type: r.hs_flow_type || "",
    trigger_type: FFA.TRIGGER_LABEL[String(trig || "").toUpperCase()] || (trig || ""),
    reenrollment: String(r.hs_re_enrollment_enabled) === "true" ? "Yes" : "No",
    description: r.hs_description || "",
    total_enrolled: num(r.hs_total_enrolled),
    enrolled_7d: num(r.hs_7_day_enrollment),
    unique_enrolled: num(r.hs_total_unique_contacts_enrolled),
    currently_enrolled: num(r.hs_currently_enrolled),
    active_issues: num(r.hs_current_active_issue_count),
    created_in: FFA.SOURCE_APP_MAP[r.hs_source_app] || r.hs_source_app || "",
    created_on: day(r.hs_flow_created_at),
    created_by: owner(r.hs_flow_created_by_user_id),
    updated_on: day(r.hs_flow_updated_at),
    updated_by: owner(r.hs_flow_updated_by_user_id),
    id: r.objectId,
    url: FFA.buildUrl(portalId, r.hs_flow_id || r.objectId),
    // Internal flags (NOT part of FFA.COLUMNS / the CSV) — used to match the HubSpot
    // Workflows list and to compute the stale signal. toCSV only emits COLUMNS, so these
    // never reach the CSV.
    _external: String(r.hs_is_external) === "true",
    _deleted: String(r.hs_is_deleted) === "true",
    _inWorkflowsUI: String(r.hs_is_external) !== "true" && String(r.hs_is_deleted) !== "true",
    _lastActionMs: Number(r.hs_last_action_execution_date) || 0
  };
};
