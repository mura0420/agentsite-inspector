// Build the published agent files from inspector.hocon and agent-manifest.json.
//
//   node tools/build.mjs          writes inspector.network.json and the discovery files
//   node tools/build.mjs --check  fails if a generated file is out of date
//
// It parses and validates with the bundled reference runtime (runtime/hocon.js and
// runtime/kernel.js), so what it writes is what the browser loads.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHocon } from "../runtime/hocon.js";
import { AgentNetwork, validateNetwork } from "../runtime/kernel.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const read = (p) => readFileSync(join(root, p), "utf8");
const problems = [];

const source = read("inspector.hocon");
if (/\bTODO\b|<[a-z_]+>/.test(source.replace(/<placeholders>/g, ""))) problems.push("inspector.hocon still has TODO or <...> markers.");
const config = parseHocon(source);
const manifest = JSON.parse(read("agent-manifest.json"));
const entry = manifest.networks[0];
const network = new AgentNetwork(config, entry.name);
const result = validateNetwork(network);
problems.push(...result.errors);
if (!network.getAgentSpec(entry.front_man)) problems.push(`front_man ${entry.front_man} is not in the network.`);
for (const agent of config.tools) {
  if (!agent.function?.description) problems.push(`${agent.name} has no function.description.`);
  if (!agent.instructions) problems.push(`${agent.name} has no instructions.`);
}
// Every listed website_* tool must be mentioned, and every mentioned one listed.
const text = JSON.stringify(config);
for (const name of manifest.actions.agentTools) {
  if (!text.includes(`website_${name}`)) problems.push(`website_${name} is listed but no agent is told to use it.`);
}
for (const m of text.matchAll(/website_([a-z_]+)/g)) {
  if (!manifest.actions.agentTools.includes(m[1])) problems.push(`website_${m[1]} is mentioned but not listed in actions.agentTools.`);
}
// Agents nothing can call.
const called = new Set(config.tools.flatMap((a) => a.tools || []).filter((t) => typeof t === "string"));
for (const agent of config.tools) {
  if (agent.name !== entry.front_man && !called.has(agent.name)) problems.push(`${agent.name} is never called.`);
}
if (problems.length) {
  console.error(problems.map((p) => `error: ${p}`).join("\n"));
  process.exit(1);
}

const mcp = manifest.agent_mcp;
const outputs = {
  [entry.hocon.replace(/^\.\//, "")]: config,
  "agent-mcp.json": mcp,
  ".well-known/nsdeploy.json": manifest.linking,
  ".well-known/nsdeploy-agent.json": mcp,
  "bridge/agent-manifest.json": { networks: manifest.networks.map((n) => ({ name: n.name })), actions: { version: 1 } },
};
let stale = 0;
for (const [path, data] of Object.entries(outputs)) {
  const body = `${JSON.stringify(data, null, 2)}\n`;
  const full = join(root, path);
  if (check) {
    if (!existsSync(full) || readFileSync(full, "utf8") !== body) {
      console.error(`stale: ${path}`);
      stale += 1;
    }
  } else {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    console.log(`wrote ${path}`);
  }
}
if (stale) process.exit(1);
console.log(`ok: ${config.tools.length} agents (${config.tools.map((a) => a.name).join(", ")}), front ${entry.front_man}, tools ${manifest.actions.agentTools.map((t) => `website_${t}`).join(", ")}`);
