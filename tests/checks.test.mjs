import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { inspect, resolveTarget, RULES } from "../checks.js";
import { badgeSvg } from "../badge.js";
import { serveFolder } from "./static_server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let good;
let broken;
let noCors;

before(async () => {
  good = await serveFolder(join(here, "fixtures/good"));
  broken = await serveFolder(join(here, "fixtures/broken"));
  noCors = await serveFolder(join(here, "fixtures/good"), { cors: false });
});
after(async () => {
  await Promise.all([good.close(), broken.close(), noCors.close()]);
});

const byId = (report, id, network) => report.findings.filter((f) => f.id === id && (!network || f.network === network));
const levelOf = (report, id, network) => byId(report, id, network).map((f) => f.level);

test("resolveTarget understands site bases, manifests and network URLs", () => {
  assert.deepEqual(resolveTarget("https://a.example/agents/"), { base: "https://a.example/agents/", network: null, manifestUrl: "https://a.example/agents/agent-manifest.json" });
  assert.equal(resolveTarget("https://a.example/agents/agent-manifest.json").base, "https://a.example/agents/");
  const net = resolveTarget("https://a.example/agents/transit");
  assert.equal(net.base, "https://a.example/agents/");
  assert.equal(net.network, "transit");
  assert.equal(resolveTarget("a.example").base, "https://a.example/");
  assert.equal(resolveTarget("https://a.example/x/net.network.json").base, "https://a.example/x/");
  assert.throws(() => resolveTarget(""));
});

test("a conformant example site passes every MUST", async () => {
  const report = await inspect(good.url, { env: "node" });
  assert.equal(report.summary.fail, 0, JSON.stringify(report.findings.filter((f) => f.level === "fail"), null, 1));
  assert.deepEqual(levelOf(report, "AW-N03"), ["pass"]);
  assert.deepEqual(levelOf(report, "AW-H02"), ["pass"]);
  assert.equal(report.networks.length, 1);
  assert.equal(report.networks[0].peers[0].origin, "http://localhost:8081");
  // The example calls a loopback peer; that is accepted for local development.
  assert.deepEqual(levelOf(report, "AW-P01"), ["pass"]);
});

test("a network URL selects exactly one network and fails on an unknown name", async () => {
  const ok = await inspect(`${good.url}tidewhistle_guesthouse`, { env: "node" });
  assert.deepEqual(levelOf(ok, "AW-M04"), ["pass"]);
  const missing = await inspect(`${good.url}tidewhistle`, { env: "node" });
  assert.deepEqual(levelOf(missing, "AW-M04"), ["fail"]);
  assert.equal(missing.networks.length, 0);
});

test("missing CORS headers fail in Node, where headers are visible", async () => {
  const report = await inspect(noCors.url, { env: "node" });
  assert.deepEqual(levelOf(report, "AW-H02"), ["fail"]);
});

test("the broken fixture reports each problem under its rule", async () => {
  const report = await inspect(broken.url, { env: "node" });
  assert.equal(report.verdict, "not conformant");
  assert.deepEqual(levelOf(report, "AW-M03"), ["fail"]);
  assert.deepEqual(levelOf(report, "AW-M04"), ["fail"]);
  assert.match(byId(report, "AW-M04")[0].detail, /Duplicate network names: helpdesk/);
  assert.deepEqual(levelOf(report, "AW-M05"), ["warn"]);
  assert.deepEqual(levelOf(report, "AW-N04", "faq"), ["fail"]);
  assert.deepEqual(levelOf(report, "AW-N03", "helpdesk"), ["fail"]);
  assert.match(byId(report, "AW-N03", "helpdesk")[0].detail, /ghost_agent/);
  assert.deepEqual(levelOf(report, "AW-N05", "helpdesk"), ["warn"]);
  assert.deepEqual(levelOf(report, "AW-N06", "helpdesk"), ["fail"]);
  assert.deepEqual(levelOf(report, "AW-N08", "helpdesk"), ["warn"]);
  assert.deepEqual(levelOf(report, "AW-N09", "helpdesk"), ["fail"]);
  assert.deepEqual(levelOf(report, "AW-N10", "helpdesk"), ["fail"]);
  // The key is reported masked, never in full.
  assert.doesNotMatch(byId(report, "AW-N10", "helpdesk")[0].detail, /ABCDEFGHIJKLMNOP/);
  assert.deepEqual(levelOf(report, "AW-N11", "helpdesk"), ["warn"]);
  assert.deepEqual(levelOf(report, "AW-P01", "helpdesk"), ["fail"]);
  assert.deepEqual(levelOf(report, "AW-P02", "helpdesk"), ["warn"]);
  assert.deepEqual(levelOf(report, "AW-P03", "helpdesk"), ["warn"]);
  assert.deepEqual(levelOf(report, "AW-L01"), ["warn"]);
});

test("an unreachable site fails the manifest rule without throwing", async () => {
  const report = await inspect("http://127.0.0.1:9/", { env: "node" });
  assert.deepEqual(levelOf(report, "AW-M01"), ["fail"]);
  assert.equal(report.verdict, "not conformant");
});

test("every finding names a rule in the catalog with a spec section", async () => {
  const report = await inspect(broken.url, { env: "node" });
  for (const f of report.findings) {
    assert.ok(RULES[f.id], f.id);
    assert.match(f.section, /^\d/);
  }
});

test("the badge reflects the verdict", async () => {
  assert.match(badgeSvg({ summary: { fail: 2, warn: 0 } }), /2 failing/);
  assert.match(badgeSvg({ summary: { fail: 0, warn: 1 } }), /conformant · 1 warn/);
  assert.match(badgeSvg({ summary: { fail: 0, warn: 0 } }), />conformant</);
});

test("the published network is up to date with inspector.hocon", async () => {
  const { execFile } = await import("node:child_process");
  const code = await new Promise((resolve) => execFile("node", [join(here, "../tools/build.mjs"), "--check"], (e) => resolve(e ? e.code : 0)));
  assert.equal(code, 0);
});
