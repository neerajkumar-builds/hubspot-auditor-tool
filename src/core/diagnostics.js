// Pure diagnostics over normalized workflow rows. Attaches to window.FFA.
// Fully implemented and testable independent of the data source.
window.FFA = window.FFA || {};

function _tokens(s) {
  return new Set(
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function _jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Greedy near-duplicate clustering within the same object_type.
FFA.clusterDuplicates = function (rows, threshold) {
  threshold = threshold || FFA.DUP_SIMILARITY;
  const byObj = {};
  rows.forEach((r, i) => {
    (byObj[r.object_type] = byObj[r.object_type] || []).push({ i, r, tok: _tokens(r.description || r.name) });
  });
  const clusters = [];
  for (const obj of Object.keys(byObj)) {
    const items = byObj[obj];
    const used = new Set();
    for (let a = 0; a < items.length; a++) {
      if (used.has(a)) continue;
      const group = [items[a]];
      used.add(a);
      for (let b = a + 1; b < items.length; b++) {
        if (used.has(b)) continue;
        if (_jaccard(items[a].tok, items[b].tok) >= threshold) {
          group.push(items[b]);
          used.add(b);
        }
      }
      if (group.length > 1) {
        clusters.push({ object_type: obj, count: group.length, members: group.map((g) => g.r.name) });
      }
    }
  }
  return clusters;
};

// Split the full 0-44 set into what the HubSpot Workflows list shows (actionable) vs the
// extras it hides — external/integration-managed flows + deleted flows. The audit (counts,
// diagnostics, every report tab) runs on the actionable set so the numbers match the UI and
// no dead/uneditable links ship; the extras are reported only as a reconciliation count.
// Rows without the flags (e.g. legacy/token path) are treated as actionable.
FFA.partitionActionable = function (rows) {
  const actionable = [], extras = [];
  rows.forEach((r) => { (r._inWorkflowsUI === false ? extras : actionable).push(r); });
  return {
    actionable,
    extras: {
      total: extras.length,
      external: extras.filter((r) => r._external).length,
      deleted: extras.filter((r) => r._deleted).length
    }
  };
};

FFA.computeDiagnostics = function (rows, opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const staleMs = (FFA.STALE_DAYS || 90) * 86400000;
  const num = (v) => Number(v) || 0;
  const isOn = (r) => String(r.status).toUpperCase() === "ON";

  const flagged = rows.map((r) => {
    const on = isOn(r);
    // dormant: point-in-time — ON with 0 enrolled in the 7d before the run and 0 currently.
    const dormant = on && num(r.enrolled_7d) === 0 && num(r.currently_enrolled) === 0;
    const neverEnrolled = on && num(r.total_enrolled) === 0;          // stable
    // stale: ON and ran before but no action executed in STALE_DAYS — a stable "dead" signal,
    // far less volatile than the rolling 7-day count.
    const stale = on && r._lastActionMs > 0 && (now - r._lastActionMs) > staleMs;
    const hasErrors = num(r.active_issues) > 0;
    return { ...r, _dormant: dormant, _neverEnrolled: neverEnrolled, _stale: stale, _hasErrors: hasErrors };
  });

  const clusters = FFA.clusterDuplicates(rows);
  const inClusters = clusters.reduce((s, c) => s + c.count, 0);

  return {
    flagged,
    clusters,
    totals: {
      total: rows.length,
      on: flagged.filter((r) => isOn(r)).length,
      off: flagged.filter((r) => !isOn(r)).length,
      errored: flagged.filter((r) => r._hasErrors).length,
      dormant: flagged.filter((r) => r._dormant).length,
      neverEnrolled: flagged.filter((r) => r._neverEnrolled).length,
      stale: flagged.filter((r) => r._stale).length,
      dupClusters: clusters.length,
      flowsInClusters: inClusters
    }
  };
};

// Compare totals to the acceptance baseline; structural fields (stable) must match exactly.
// Derived figures (errored/neverEnrolled) are point-in-time and informational only.
FFA.checkAcceptance = function (totals) {
  const a = FFA.ACCEPTANCE;
  const diff = (k) => ({ field: k, got: totals[k], want: a[k], ok: totals[k] === a[k] });
  return {
    structural: ["total", "on", "off"].map(diff),     // must pass
    derived: ["errored", "neverEnrolled"].map(diff)    // informational
  };
};
