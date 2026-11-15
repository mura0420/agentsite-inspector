#!/usr/bin/env node
// Agent Site Inspector CLI: check an open agentic website from a terminal or CI.
//
// Usage: node cli/inspect.mjs <site, manifest or network URL> [--json] [--origin <origin>]
//        [--badge <file.svg>] [--fail-on warn|fail]
// Exits with 1 when it finds a finding at or above --fail-on (default: fail).
import { writeFileSync } from "node:fs";
import { inspect } from "../checks.js";
import { badgeSvg } from "../badge.js";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const asJson = flag("--json");
const origin = option("--origin") || undefined;
const badge = option("--badge");
const failOn = option("--fail-on") || "fail";
const target = args[0];
if (!target) {
  console.error("Usage: node cli/inspect.mjs <url> [--json] [--origin <origin>] [--badge out.svg] [--fail-on warn|fail]");
  process.exit(2);
}
const report = await inspect(target, { env: "node", origin });
if (!report.ok) {
  console.error(report.reason);
  process.exit(2);
}
if (badge) writeFileSync(badge, badgeSvg(report));
if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const color = { fail: "\x1b[31m", warn: "\x1b[33m", pass: "\x1b[32m", info: "\x1b[36m" };
  const tty = process.stdout.isTTY || process.env.FORCE_COLOR;
  const paint = (level, text) => (tty ? `${color[level]}${text}\x1b[0m` : text);
  console.log(`Agent Site Inspector — ${report.spec.version}`);
  console.log(`Target: ${report.target.base}${report.target.network ? ` (network ${report.target.network})` : ""}\n`);
  for (const f of report.findings) {
    const where = f.network ? ` [${f.network}]` : "";
    console.log(`${paint(f.level, f.level.toUpperCase().padEnd(4))} ${f.id} §${f.section} ${f.title}${where}`);
    console.log(`     ${f.detail}`);
    if (f.fix) console.log(`     fix: ${f.fix}`);
  }
  for (const n of report.networks) {
    console.log(`\nNetwork ${n.name} -> ${n.networkUrl}`);
    for (const a of n.agents) {
      const tools = a.tools.map((t) => (t.kind === "agent" ? t.ref : `${t.kind}:${t.url || t.ref}`)).join(", ");
      console.log(`  ${a.front ? "*" : "-"} ${a.name}: ${tools || "(no tools)"}`);
    }
  }
  const s = report.summary;
  console.log(`\n${paint(s.fail ? "fail" : s.warn ? "warn" : "pass", report.verdict.toUpperCase())}: ${s.fail} fail, ${s.warn} warn, ${s.pass} pass`);
}
const s = report.summary;
process.exit(s.fail || (failOn === "warn" && s.warn) ? 1 : 0);
