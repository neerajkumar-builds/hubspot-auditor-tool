// Build: assemble each extension variant from the single-source core + its overlay into
// dist/<variant>/, in the flat layout Chrome MV3 manifests expect. Pure file copies — the
// engine content is never transformed, so a built variant is byte-identical to its source.
//
//   dist/<variant>/
//     manifest.json, popup.html, popup.js   (from src/<variant>/)
//     content.js                            (from src/core/)
//     icons/*                               (from assets/icons/)
//     src/*.js                              (core engine modules; external adds leadgate + config)
//
// Usage: node tools/build.mjs            (builds both variants)
//        node tools/build.mjs internal   (one variant)
import { readFileSync, writeFileSync, rmSync, mkdirSync, copyFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = (...x) => join(ROOT, ...x);

const CORE_TO_ROOT = ["content.js"];
const CORE_TO_SRC = ["config.js", "diagnostics.js", "csv.js", "xlsx.js",
  "audit-properties.js", "audit-lists.js", "audit-forms.js", "audit-flowmaps.js"];
const VARIANT_ROOT = ["manifest.json", "popup.html", "popup.js"];
const ICONS = ["icon16.png", "icon48.png", "icon128.png", "mark-white.png"];

function buildVariant(variant) {
  const out = p("dist", variant);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "src"), { recursive: true });
  mkdirSync(join(out, "icons"), { recursive: true });

  CORE_TO_ROOT.forEach((f) => copyFileSync(p("src/core", f), join(out, f)));
  CORE_TO_SRC.forEach((f) => copyFileSync(p("src/core", f), join(out, "src", f)));
  VARIANT_ROOT.forEach((f) => copyFileSync(p("src", variant, f), join(out, f)));
  ICONS.forEach((f) => copyFileSync(p("assets/icons", f), join(out, "icons", f)));

  if (variant === "external") {
    copyFileSync(p("src/external/leadgate.js"), join(out, "src", "leadgate.js"));
    // prefer the real (gitignored) config; fall back to the committed template
    const real = p("src/external/config-external.js");
    const tmpl = p("src/external/config-external.example.js");
    const cfgSrc = existsSync(real) ? real : tmpl;
    copyFileSync(cfgSrc, join(out, "src", "config-external.js"));
    injectN8nHost(join(out, "manifest.json"), cfgSrc);
  }

  const n = readdirSync(join(out, "src")).length;
  console.log(`built dist/${variant}  (${n} src files)`);
}

// Replace the placeholder host in the external manifest with the real n8n origin from config.
function injectN8nHost(manifestPath, configPath) {
  const m = (readFileSync(configPath, "utf8").match(/webhook:\s*["']([^"']+)["']/) || [])[1];
  if (!m) return;
  let host;
  try { host = new URL(m).origin; } catch { return; }
  if (host.includes("YOUR-N8N-HOST")) return; // template — leave placeholder
  const mf = readFileSync(manifestPath, "utf8").replace("https://YOUR-N8N-HOST/*", host + "/*");
  writeFileSync(manifestPath, mf);
}

const only = process.argv[2];
(only ? [only] : ["internal", "external"]).forEach(buildVariant);
