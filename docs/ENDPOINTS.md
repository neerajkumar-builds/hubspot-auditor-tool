# HubSpot Endpoints

All endpoints are HubSpot's own internal app APIs, called from the content script with the
operator's session — `credentials: "include"` plus the CSRF header
`X-HubSpot-CSRF-hubspotapi`, whose value is read from the non-HttpOnly `hubspotapi-csrf`
cookie. They are **undocumented** and may change; each module fails soft if one does.

> These were identified by observing the network traffic of HubSpot's own UI on a real
> portal, then replicated. Nothing here bypasses authentication or authorization — the tool
> can only read what the logged-in user can already see.

## Workflows — the core audit
`POST {origin}/api/crm-search/search?portalId=<P>&clienttimeout=14000`

```jsonc
{
  "objectTypeId": "0-44",            // internal CRM object for automations/flows
  "count": 100, "offset": 0,
  "query": "", "filterGroups": [],
  "sorts": [{ "property": "hs_object_id", "order": "ASC" }],   // REQUIRED — see gotcha 1
  "requestOptions": { "properties": [ "hs_name", "hs_enabled", "hs_object_type_id",
    "hs_flow_type", "hs_enrollment_trigger", "hs_re_enrollment_enabled", "hs_description",
    "hs_total_enrolled", "hs_7_day_enrollment", "hs_total_unique_contacts_enrolled",
    "hs_currently_enrolled", "hs_current_active_issue_count", "hs_source_app",
    "hs_flow_created_at", "hs_flow_created_by_user_id", "hs_flow_updated_at",
    "hs_flow_updated_by_user_id", "hs_flow_id" ] }
}
```

Response: `{ total, hasMore, offset, results: [ { objectId, properties: { <name>: { value } } } ] }`.
Mapped to the CSV schema by `FFA.mapSessionRow`. `id` = `objectId` (matches HubSpot's
internal record id); the editor URL uses `hs_flow_id`.

**Gotcha 1 — pagination is non-deterministic without a sort.** With `sorts: []`, successive
offset pages overlap/skip, so the collected set isn't the true N and the on/off split drifts
run-to-run. Fix: sort by the immutable `hs_object_id` and dedupe by `objectId`.

## Owners — name resolution
`GET {origin}/api/crm/v3/owners?portalId=<P>&limit=500` (paginated via `paging.next.after`).
Builds a `userId|id → "First Last"` map; `created_by` / `updated_by` resolve best-effort
(deactivated/legacy users won't resolve and are left blank).

## Properties — custom-field hygiene
`GET {origin}/api/properties/v4/{objectTypeId}` → array of `{ property: {...} }`. Custom =
`property.createdUserId != null`. Cheap flags: undocumented (no description), duplicate label.

**Fill-rate (opt-in)** uses the aggregation endpoint:
`POST {origin}/api/crm-search/report` with
`aggregations: [{ name, type: "MISSING", property, missingValue: "<sentinel>", size: 1 }]`.
`filled = total_count − missing_count`; `filled == 0` ⇒ never used.

**Gotcha 2 — `report` caps at 10 aggregations per call.** Batch properties in groups of 10.
**Gotcha 3 — `MISSING` requires a `missingValue` sentinel and a `size`**, or it 400s.

## Lists
`POST {origin}/api/crm/v3/lists/search` with `{ count, offset, query }` →
`{ lists: [ { listId, name, processingType, objectTypeId, additionalProperties: {
hs_list_size, hs_list_reference_count } } ] }`. Flags: `hs_list_size == 0` (empty) and
`hs_list_reference_count == 0` (unused — nothing points at it).

## Forms
`GET {origin}/api/forms/v2/forms?limit=250&offset=N` → array of form objects. Flags:
`!isPublished` (unpublished) and `updatedAt` older than 18 months (stale). Submission counts
are not in this payload (they'd require analytics calls) and are intentionally left out.

## Flow step-maps + conflicts (opt-in, heaviest)
`GET {origin}/api/automation/v4/flows/{hs_flow_id}` → `{ actions: [ { actionTypeId, type,
fields, connection } ] }`. One call per **active** flow (throttled). Action vocabulary
observed: `0-1` delay, `0-4` send marketing email, `0-5` set property (`fields.property_name`),
`0-3` create task, `0-23` internal email, `1-*` Slack/webinar, `type` containing `BRANCH`
⇒ if/then. Conflicts = any property written by more than one active flow.

## Object type IDs seen in the wild
`0-1` Contact · `0-2` Company · `0-3` Deal · `0-5` Ticket · `0-11` Conversation ·
`0-14` Quote · `0-101` Commerce Payment · `0-115` User · `0-136` Lead · `0-422` Data Privacy
Request. Unknown ids pass through as the raw id (a row is never dropped).
