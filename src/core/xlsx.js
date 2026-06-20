// Self-contained .xlsx writer + audit-workbook builder. No dependencies, no remote code
// (MV3-safe). Produces the same 6-sheet branded workbook as build_audit.py, in-browser.
// Attaches to window.FFA. Node-testable (uses only TextEncoder / Uint8Array / standard JS).
(function () {
  const FFA = (typeof window !== "undefined" ? window : globalThis).FFA = (typeof window !== "undefined" ? window : globalThis).FFA || {};
  const B = FFA.BRAND || { accent: "#146DFA", dark: "#0A0A0A", light: "#F9F9F9" };
  const hex = (h) => (h || "").replace("#", "").toUpperCase();

  // ---------- CRC32 (for the zip) ----------
  const CRC = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ---------- minimal STORE zip ----------
  function zip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const u16 = (n) => [n & 255, (n >>> 8) & 255];
    const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    files.forEach((f) => {
      const data = enc.encode(f.content);
      const name = enc.encode(f.name);
      const crc = crc32(data);
      const local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(local), name, data);
      const cen = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset));
      central.push(new Uint8Array(cen), name);
      offset += local.length + name.length + data.length;
    });
    let cenSize = 0; central.forEach((p) => cenSize += p.length);
    const eocd = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0),
      u16(files.length), u16(files.length), u32(cenSize), u32(offset), u16(0)));
    const all = parts.concat(central, [eocd]);
    let total = 0; all.forEach((p) => total += p.length);
    const out = new Uint8Array(total); let pos = 0;
    all.forEach((p) => { out.set(p, pos); pos += p.length; });
    return out;
  }

  // ---------- XML helpers ----------
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const colLetter = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };

  // Shared cell builders + style indices so audit modules can build their own sheets
  // (styles: 1 header / 2 bold / 3 title / 4 grey / 5 hyperlink). Append via buildWorkbookBytes(rows, meta, extraSheets).
  FFA.xl = {
    S: (v, s) => ({ v: v, s: s }), N: (n, s) => ({ n: n, s: s }),
    LINK: (url) => (url ? { t: "f", url: url, text: "Open" } : ""),
    up: (s) => (s == null ? "" : String(s)).toUpperCase(),
    HEADER: 1, BOLD: 2, TITLE: 3, GREY: 4, LINK_STYLE: 5
  };

  // styles: 0 normal | 1 header(white bold, accent fill) | 2 bold | 3 title | 4 grey | 5 link(blue underline)
  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/><color rgb="FF222222"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF222222"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>
<font><b/><sz val="16"/><name val="Calibri"/><color rgb="FF${hex(B.dark)}"/></font>
<font><sz val="10"/><name val="Calibri"/><color rgb="FF888888"/></font>
<font><u/><sz val="11"/><name val="Calibri"/><color rgb="FF${hex(B.accent)}"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF${hex(B.accent)}"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }

  // cell: v=value, s=style, t: 's'(string)|'n'(number)|'f'(hyperlink formula)
  function cell(ref, c) {
    if (c == null || c === "") return `<c r="${ref}"/>`;
    if (typeof c === "object") {
      if (c.t === "f") return `<c r="${ref}" s="5" t="str"><f>HYPERLINK(&quot;${esc(c.url)}&quot;,&quot;${esc(c.text || "Open")}&quot;)</f><v>${esc(c.text || "Open")}</v></c>`;
      const s = c.s != null ? ` s="${c.s}"` : "";
      if (c.n != null && c.n !== "") return `<c r="${ref}"${s}><v>${c.n}</v></c>`;
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
    }
    if (typeof c === "number") return `<c r="${ref}"><v>${c}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`;
  }

  // sheet: rows = array of arrays; opts {cols:[w], freeze:bool, filter:bool}
  function sheetXml(rows, opts) {
    opts = opts || {};
    const sv = opts.freeze
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>`
      : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
    const cols = opts.cols ? `<cols>${opts.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    let maxc = 1;
    const body = rows.map((r, ri) => {
      maxc = Math.max(maxc, r.length);
      const cells = r.map((c, ci) => cell(colLetter(ci + 1) + (ri + 1), c)).join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join("");
    const filter = opts.filter ? `<autoFilter ref="A1:${colLetter(maxc)}${rows.length}"/>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sv}${cols}<sheetData>${body}</sheetData>${filter}</worksheet>`;
  }

  // ---------- audit model (mirrors build_audit.py) ----------
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const isOn = (r) => String(r.status).toUpperCase() === "ON";

  function classify(r) {
    const n = (r.name || "").toLowerCase(), d = (r.description || "").toLowerCase(), t = n + " " + d;
    const has = (...ks) => ks.some((k) => t.includes(k));
    if (/\btest\b/.test(n)) return "Test / Internal";
    if (has("gdpr", "consent", "marketing contact", "unsubscrib", "subscription", "opt them into", "opt-in", "opt out")) return "Compliance & Marketing Status";
    if (has("slack")) return "Slack & Notifications";
    if (has("creates a note", "pinned note") || /\bnote\b/.test(n)) return "Notes & Record Updates";
    if (has("creates a task", "create a task", "call task", "task to", "creates a call")) return "Task & Call Creation";
    if (has("assign", "routing", "round robin", "rotate", "forecast category", "lead owner")) return "Lead Routing & Assignment";
    if (has("lifecycle", "lead score", "scoring", "became", "sal date", "stage based on", "mql", "sql")) return "Lifecycle & Scoring";
    if (has("deal", "pipeline", "forecast", "closed won", "close date", "rep confidence", "customer success", "cs-", "onboarding survey", "churn")) return "Deal & CS Ops";
    if (has("email", "follow-up", "follow up", "nurture", "sequence", "thank-you", "thank you", "reminder", "send a series")) return "Email & Nurture";
    if (has("copy", "populate", "enrich", "clay", "set the", "sets the", "portal id", "property to", "data engine")) return "Data & Enrichment";
    return "Other / Uncategorized";
  }

  const STOP = new Set("the and for to from of a an in on with new set copy flow workflow wf push slack email update updates create creates contact contacts company deal lead ff hubspot via based when".split(" "));
  function nameTokens(s) {
    return new Set(String(s || "").toLowerCase().replace(/\d+/g, " ").replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
  }
  function jac(a, b) { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); }
  function cluster(rows, thresh) {
    thresh = thresh || 0.34;
    const byObj = {};
    rows.forEach((r) => (byObj[r.object_type] = byObj[r.object_type] || []).push(r));
    const out = [];
    for (const obj in byObj) {
      const items = byObj[obj], toks = items.map((r) => nameTokens(r.name)), used = new Set();
      for (let a = 0; a < items.length; a++) {
        if (used.has(a)) continue;
        const g = [items[a]]; used.add(a);
        for (let b = a + 1; b < items.length; b++) { if (used.has(b)) continue; if (jac(toks[a], toks[b]) >= thresh) { g.push(items[b]); used.add(b); } }
        if (g.length > 1) out.push({ obj, group: g });
      }
    }
    return out;
  }

  FFA.buildAuditModel = function (rows) {
    rows.forEach((r) => { r._fn = classify(r); });
    const on = rows.filter(isOn), off = rows.filter((r) => !isOn(r));
    const errored = rows.filter((r) => num(r.active_issues) > 0);
    const dormant = on.filter((r) => num(r.enrolled_7d) === 0 && num(r.currently_enrolled) === 0);
    const never = on.filter((r) => num(r.total_enrolled) === 0);
    const dormantOnly = dormant.filter((r) => num(r.total_enrolled) > 0);
    const clusters = cluster(rows).sort((a, b) => b.group.length - a.group.length);
    const inClusters = clusters.reduce((s, c) => s + c.group.length, 0);
    return { on, off, errored, dormant, never, dormantOnly, clusters, inClusters,
      pct: rows.length ? Math.round(100 * inClusters / rows.length) : 0 };
  };

  // ---------- workbook ----------
  FFA.buildWorkbookBytes = function (rows, meta, extraSheets) {
    meta = meta || {};
    const m = FFA.buildAuditModel(rows);
    const S = (v, s) => ({ v: v, s: s });            // styled string
    const N = (n, s) => ({ n: n, s: s });            // number
    const LINK = (url) => url ? { t: "f", url: url, text: "Open" } : "";
    const up = (s) => (s || "").toUpperCase();

    // --- Diagnostic ---
    const diag = [];
    diag.push([]);
    diag.push(["", S("HubSpot Workflow Audit — FullFunnel", 3)]);
    diag.push(["", S(`Portal ${meta.portal || "?"} · ${rows.length} automation flows indexed · ${meta.date || ""}`, 4)]);
    diag.push([]);
    diag.push(["", S("Headline findings", 2)]);
    const findings = [
      ["Total automation flows", rows.length, "Indexed via internal CRM object 0-44"],
      ["Active (ON)", m.on.length, "Currently enabled"],
      ["Inactive (OFF)", m.off.length, "Archive / delete review"],
      ["Flows with HubSpot-flagged errors", m.errored.length, "Fix or retire — see Cleanup Queue"],
      ["Active but DORMANT", m.dormant.length, "On, but 0 enrolled in 7d and 0 currently"],
      ["  …of those, NEVER enrolled anyone", m.never.length, "Strong delete candidates"],
      ["Near-duplicate clusters", m.clusters.length, "Consolidation opportunities — see Consolidation Map"],
      ["Workflows inside those clusters", m.inClusters, `${m.pct}% of all flows look like duplicates`]
    ];
    findings.forEach(([l, v, note]) => diag.push(["", l, N(v, 2), S(note, 4)]));
    diag.push([]);
    diag.push(["", S("Recommended actions (priority order)", 2)]);
    diag.push(["", S("Action", 2), S("Priority", 2), S("Why", 2)]);
    [["Fix or kill the flagged-error flows", "High", "They may be failing silently. Triage in Cleanup Queue."],
     ["Retire never-enrolled active flows + review other dormant", "Medium", "On but idle = risk + clutter. Confirm not seasonal."],
     ["Consolidate the largest near-duplicate clusters", "High", "Highest-leverage dedup — see Consolidation Map."],
     ["Archive the OFF flows that are truly retired", "Low", "Reduces the in-app surface and audit noise."],
     ["Establish naming + ownership governance", "Med", "Most clusters trace to one-off builds."]
    ].forEach((a) => diag.push(["", a[0], a[1], S(a[2], 4)]));

    // --- Remediation Plan (services-ready proposal) ---
    const rem = [];
    rem.push([]);
    rem.push(["", S("Remediation Plan — FullFunnel", 3)]);
    rem.push(["", S(`Portal ${meta.portal || "?"} · scoped cleanup from ${rows.length} workflows · ${meta.date || ""}`, 4)]);
    rem.push([]);
    rem.push(["", S("The opportunity", 2)]);
    rem.push(["", S("Action area", 1), S("Count", 1), S("Why", 1)]);
    [["Fix — silently erroring", m.errored.length, "May be failing with no one watching"],
     ["Delete — on but never enrolled anyone", m.never.length, "Safe to remove"],
     ["Review — on but dormant", m.dormantOnly.length, "Confirm not seasonal, then disable/delete"],
     ["Archive — switched off", m.off.length, "Reduce clutter + audit surface"],
     ["Consolidate — near-duplicate clusters", m.clusters.length, `${m.inClusters} flows could collapse toward ~${m.clusters.length}`]
    ].forEach((r) => rem.push(["", r[0], N(r[1], 2), S(r[2], 4)]));
    rem.push([]);
    rem.push(["", S("Recommended sequence", 2)]);
    [`1. Triage the ${m.errored.length} erroring flows — fix or retire (see "Fix first" below).`,
     `2. Delete the ${m.never.length} active flows that have never enrolled anyone.`,
     `3. Consolidate the top duplicate clusters into branched flows (see targets below).`,
     `4. Review the ${m.dormantOnly.length} dormant flows; disable the clearly dead.`,
     `5. Archive the ${m.off.length} switched-off flows that are truly retired.`,
     `6. Put naming + ownership governance in place so this doesn't recur.`
    ].forEach((s) => rem.push(["", s]));
    rem.push([]);
    rem.push(["", S("Top consolidation targets", 2)]);
    rem.push(["", S("Object", 1), S("# flows", 1), S("Merge into", 1), S("Members (sample)", 1)]);
    m.clusters.slice(0, 8).forEach((c) => rem.push(["", up(c.obj), N(c.group.length), "1 branched flow", c.group.slice(0, 4).map((r) => r.name).join("; ")]));
    rem.push([]);
    rem.push(["", S("Fix first — erroring flows", 2)]);
    rem.push(["", S("Workflow", 1), S("Object", 1), S("Issues", 1), S("Link", 1)]);
    m.errored.forEach((r) => rem.push(["", r.name, up(r.object_type), N(num(r.active_issues)), LINK(r.url)]));

    // --- Consolidation Map ---
    const cmHead = ["#", "Object", "# flows", "On", "Off", "Member workflow", "Status", "Enr.7d"];
    const cm = [cmHead.map((h) => S(h, 1))];
    m.clusters.forEach((c, i) => {
      const gon = c.group.filter(isOn).length;
      c.group.forEach((r, j) => cm.push([
        j === 0 ? i + 1 : "", j === 0 ? up(c.obj) : "", j === 0 ? c.group.length : "",
        j === 0 ? gon : "", j === 0 ? c.group.length - gon : "",
        r.name, r.status, num(r.enrolled_7d)
      ]));
    });

    // --- Cleanup Queue ---
    const cqHead = ["Priority", "Flag", "In dup cluster", "Workflow", "Status", "Object", "Function", "Enr.total", "Issues", "Updated", "Link"];
    const cq = [cqHead.map((h) => S(h, 1))];
    const clustered = new Set(); m.clusters.forEach((c) => c.group.forEach((r) => clustered.add(r.name)));
    const qrow = (r, pri, flag) => [pri, flag, clustered.has(r.name) ? "Yes" : "", r.name, r.status, up(r.object_type), r._fn, num(r.total_enrolled), num(r.active_issues), r.updated_on, LINK(r.url)];
    m.errored.forEach((r) => cq.push(qrow(r, "High", "Has errors")));
    m.never.forEach((r) => cq.push(qrow(r, "High", "Never enrolled anyone")));
    m.dormantOnly.forEach((r) => cq.push(qrow(r, "Medium", "Active but dormant")));
    m.off.forEach((r) => cq.push(qrow(r, "Low", "Switched off")));

    // --- list sheets ---
    const disp = ["Workflow Name", "Status", "Object", "Function", "Trigger", "Re-enroll", "Description",
      "Enrolled (total)", "Enrolled 7d", "Unique", "Currently", "Issues", "Created In",
      "Created", "Created By", "Updated", "Updated By", "Link", "HubSpot ID"];
    const drow = (r) => [r.name, r.status, up(r.object_type), r._fn, r.trigger_type, r.reenrollment, r.description,
      num(r.total_enrolled), num(r.enrolled_7d), num(r.unique_enrolled), num(r.currently_enrolled), num(r.active_issues),
      r.created_in, r.created_on, r.created_by, r.updated_on, r.updated_by, LINK(r.url), r.id];
    const listSheet = (data) => [disp.map((h) => S(h, 1))].concat(data.map(drow));

    const dispW = [40, 7, 13, 22, 16, 9, 55, 13, 10, 9, 10, 7, 18, 11, 16, 11, 16, 7, 14];
    const sheets = [
      { name: "Diagnostic", xml: sheetXml(diag, { cols: [4, 44, 12, 60] }) },
      { name: "Remediation Plan", xml: sheetXml(rem, { cols: [4, 44, 13, 30, 50] }) },
      { name: "Consolidation Map", xml: sheetXml(cm, { cols: [5, 16, 8, 6, 6, 46, 8, 9], freeze: true }) },
      { name: "Cleanup Queue", xml: sheetXml(cq, { cols: [9, 22, 13, 42, 7, 14, 24, 10, 7, 12, 8], freeze: true, filter: true }) },
      { name: "All Workflows", xml: sheetXml(listSheet(rows), { cols: dispW, freeze: true, filter: true }) },
      { name: "Active (ON)", xml: sheetXml(listSheet(m.on), { cols: dispW, freeze: true, filter: true }) },
      { name: "Inactive (OFF)", xml: sheetXml(listSheet(m.off), { cols: dispW, freeze: true, filter: true }) }
    ];

    // Append optional module sheets (Properties / Lists / Forms / Flow Maps / Conflicts).
    // Each: { name, rows (cells via FFA.xl), cols, freeze?, filter? }. Workflow sheets above are untouched.
    (extraSheets || []).forEach((s) => {
      if (s && s.rows && s.rows.length) sheets.push({ name: s.name, xml: sheetXml(s.rows, { cols: s.cols, freeze: s.freeze, filter: s.filter }) });
    });

    const sheetRefs = sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
    const wbRels = sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
    const ctOverrides = sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");

    const files = [
      { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ctOverrides}</Types>` },
      { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetRefs}</sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wbRels}</Relationships>` },
      { name: "xl/styles.xml", content: stylesXml() }
    ];
    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, content: s.xml }));
    return zip(files);
  };

  // browser download of the bytes
  FFA.downloadXLSX = function (bytes, filename) {
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename || "audit.xlsx";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
})();
