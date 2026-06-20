# Product Requirements

## Problem
HubSpot accounts accumulate automation debt that the native UI never surfaces in aggregate:
workflows left on but idle, workflows erroring silently, large clusters of near-duplicate
workflows, and thousands of unused lists and custom properties. Operators and consultants
have no fast way to see the whole picture, so cleanup never starts and the account keeps
degrading.

## Goal
Give an operator a one-click, read-only audit of a HubSpot account that produces a
prioritized, shareable cleanup plan in seconds — without API setup or IT involvement.

## Users
- **Internal operators / consultants** running an audit at the start of an engagement.
- **External prospects** (free variant) who run a self-serve audit on their own account.

Both are already logged into HubSpot in their browser; neither will configure an API token
or run a terminal.

## Constraints that shaped the design
- **Login, not a token.** Clients hand over a seat, not API access. The tool must work off
  the authenticated browser session.
- **The valuable metrics are UI-only.** Enrollment counts and active-issue flags aren't in
  the public Automation API; they come from HubSpot's internal CRM object for automations.
- **Trust.** Reading a client's CRM demands that nothing leaves the browser.
- **Manifest V3.** No remote code; everything bundled and reviewable.

## Scope

### In scope
- Auto-detect the portal from the active HubSpot tab.
- Full workflow inventory with status, enrollment, active-issues, trigger, source, owner.
- Client-side diagnostics: on/off, dormant, never-enrolled, has-errors, near-duplicate clusters.
- Optional add-on audits: lists, custom properties (+ fill-rate), forms, flow step-maps, conflicts.
- A remediation plan and a branded multi-tab Excel export (+ CSV).
- A free, gated external variant that captures a lead before unlocking.

### Out of scope
- Writing to or modifying HubSpot (the tool is strictly read-only).
- Storing client CRM data anywhere off-device.
- Salesforce / other CRMs (future).
- Scheduled or server-side runs.

## Success criteria
- Workflow totals reproduce the validated reference exactly on the benchmark portal.
- A run completes in seconds for the default (workflow) audit; opt-in modules are clearly
  marked as slower.
- The export is clean enough to send to a client as-is.
- No credential or CRM data is ever logged, persisted, or transmitted (lead form excepted,
  external variant only).

## Non-goals / explicit trade-offs
- The tool depends on HubSpot's **undocumented internal endpoints**. They can change; the
  tool is treated as a fast-to-patch utility, not a contract-stable integration.
- Duplicate-cluster detection is a heuristic (it surfaces consolidation candidates, not a
  provably minimal set).
