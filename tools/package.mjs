// Package: zip each built variant in dist/ into a loadable .zip (for Web Store upload or
// sharing). Run `npm run build` first (or use `npm run package`, which builds then zips).
// Uses the system `zip`; the archive's top folder is the variant name.
import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const VARIANTS = ["internal", "external"];

if (!existsSync(DIST)) { console.error("No dist/ — run `npm run build` first."); process.exit(1); }
mkdirSync(join(DIST, "zips"), { recursive: true });

for (const v of VARIANTS) {
  const src = join(DIST, v);
  if (!existsSync(src)) continue;
  const zip = join(DIST, "zips", `hubspot-workflow-auditor-${v}.zip`);
  execFileSync("zip", ["-rq", zip, v, "-x", ".*"], { cwd: DIST });
  console.log(`packaged ${zip}`);
}
