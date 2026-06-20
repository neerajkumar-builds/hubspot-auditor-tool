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

// Acceptance oracle (validated HubSpot_Workflow_Audit.xlsx, portal 545075).
FFA.ACCEPTANCE = {
  portal: "545075",
  total: 229, on: 134, off: 95,
  errored: 14, dormant: 111, neverEnrolled: 10, dupClusters: 33
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
    "hs_flow_updated_at", "hs_flow_updated_by_user_id", "hs_flow_id"
  ]
};

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
    url: FFA.buildUrl(portalId, r.hs_flow_id || r.objectId)
  };
};
