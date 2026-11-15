// checks.js — conformance checks for an open agentic website.
//
// It reads a site's public agent files the way a calling browser reads them and checks
// them against the Minimum Viable Specification for a Worldwide Agentic Web (MVP
// Profile 0.2). It runs unchanged in the browser (the Inspector page and its agent) and
// in Node (cli/inspect.mjs, CI).
//
// The network check uses the reference browser runtime's own parser and validator
// (runtime/hocon.js, runtime/kernel.js), so a network that passes here also loads there.
//
// It only reads public files (GET, no cookies, no credentials). It never follows a peer
// network to another origin by itself: peers are listed, and the caller decides.

import { parseHocon } from "./runtime/hocon.js";
import { AgentNetwork, validateNetwork, isMcpTool } from "./runtime/kernel.js";

export const SPEC = {
  name: "Minimum Viable Specification for a Worldwide Agentic Web",
  version: "MVP Profile 0.2 (6 November 2026)",
  url: "https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md",
};

// The rule catalog. Each finding names one of these ids. "level" is the level when the
// rule is broken: "fail" for a MUST, "warn" for a SHOULD or for something that stops
// callers in practice. Spec text is paraphrased, with the section to read.
export const RULES = {
  "AW-M01": { level: "fail", section: "3.3", title: "Manifest is published",
    why: "Callers find a site's networks through agent-manifest.json at the site base. Without it, no other site can load the network.",
    fix: "Publish agent-manifest.json in the folder that holds your network files, and serve it with a plain public GET." },
  "AW-M02": { level: "fail", section: "3.3", title: "Manifest is valid JSON",
    why: "The manifest is machine-readable data that every runtime parses.",
    fix: "Run the file through a JSON parser and fix the reported position. Remove comments and trailing commas." },
  "AW-M03": { level: "fail", section: "3.3", title: "Manifest lists networks with name, front_man and hocon",
    why: "Each published network needs a name, its front agent and the location of its resolved definition.",
    fix: "Add a networks array with entries like {\"name\": \"my_network\", \"front_man\": \"front_desk\", \"hocon\": \"./my_network.network.json\"}." },
  "AW-M04": { level: "fail", section: "3.2", title: "Network names are unique and exact",
    why: "A caller selects the entry whose name exactly matches the last path component of the network URL, and must fail if there is no exact match.",
    fix: "Give every network a distinct name made of letters, digits, - or _, and use that same name in the URL you share." },
  "AW-M05": { level: "warn", section: "3.3", title: "Manifest declares an LLM router",
    why: "The manifest carries top-site LLM router metadata, so the site's default inference path is known.",
    fix: "Add \"llm_router\": {\"base_url\": \"https://your-router.example/v1\"} (and byok_router if you offer BYOK)." },
  "AW-M06": { level: "warn", section: "3.3", title: "Manifest declares a peer policy",
    why: "Peer-policy metadata states which peer origins may be contacted. Without it, a reader cannot tell what your network will reach.",
    fix: "Add \"peer_policy\": {\"mode\": \"closed\"} and an \"allowed_peers\" list with the origins your agents call." },
  "AW-H01": { level: "fail", section: "3.2", title: "Files are served over HTTPS",
    why: "HTTPS is required except during local development.",
    fix: "Host the bundle on an HTTPS origin (GitHub Pages, Netlify, Cloudflare Pages and most hosts do this by default)." },
  "AW-H02": { level: "fail", section: "3.4", title: "Public files allow cross-origin reads (CORS)",
    why: "When another origin loads your manifest or network, the publisher must permit browser access with standard cross-origin controls.",
    fix: "Send Access-Control-Allow-Origin: * on agent-manifest.json, the network file and links.json. Static hosts usually let you set this in a headers file." },
  "AW-H03": { level: "warn", section: "3.4", title: "CORS does not depend on credentials",
    why: "Public artifact requests must not include the caller's private credentials, so the files must load without cookies.",
    fix: "Use Access-Control-Allow-Origin: * without Access-Control-Allow-Credentials for public agent files." },
  "AW-N01": { level: "fail", section: "3.2", title: "Network definition is reachable",
    why: "The runtime resolves the manifest's hocon value against the site base and fetches it before execution.",
    fix: "Check the hocon path in the manifest. A relative path is resolved against the folder that holds agent-manifest.json." },
  "AW-N02": { level: "fail", section: "2", title: "Network definition parses",
    why: "The published form is a resolved, data-only HOCON or JSON document.",
    fix: "Publish the resolved .network.json your build writes, not the source .hocon with includes." },
  "AW-N03": { level: "fail", section: "3.1", title: "Network passes the reference runtime's validator",
    why: "A runtime rejects malformed networks, duplicate or missing agent references and an invalid front agent before any model call.",
    fix: "Fix each validator message. They come from the same validator the reference browser runtime runs." },
  "AW-N04": { level: "fail", section: "2.1", title: "front_man names an agent in the network",
    why: "The manifest's front_man must be the network's public entry point.",
    fix: "Set front_man in the manifest to the name of an agent in the network's tools list." },
  "AW-N05": { level: "warn", section: "2.1", title: "Network has a description",
    why: "Minimum network content includes a short description.",
    fix: "Add metadata.description (one sentence) to the network." },
  "AW-N06": { level: "fail", section: "2.1", title: "Every agent has a function description",
    why: "Each agent has a function description, so callers can decide when to use it.",
    fix: "Add function.description to every agent." },
  "AW-N07": { level: "fail", section: "2.1", title: "Every LLM agent has instructions",
    why: "Agents that use an LLM carry instructions.",
    fix: "Add instructions to every agent that is not a coded tool." },
  "AW-N08": { level: "warn", section: "2.1", title: "Callable agents declare input schemas",
    why: "Callable agents expose JSON Schema-compatible inputs.",
    fix: "Add function.parameters as {\"type\": \"object\", \"properties\": {...}, \"required\": [...]}." },
  "AW-N09": { level: "fail", section: "2.2", title: "Definition is data only",
    why: "The published form must not depend on local includes, environment substitutions or publisher-only file paths.",
    fix: "Resolve includes and ${...} substitutions at build time, and remove local paths." },
  "AW-N10": { level: "fail", section: "4", title: "No credentials in the published definition",
    why: "Published instructions are public, and keys must never appear in manifests or network specifications.",
    fix: "Remove the key, revoke it with its provider, and let visitors bring their own key (BYOK) or use a server-side router." },
  "AW-N11": { level: "warn", section: "2.1", title: "Private context crosses boundaries only by name",
    why: "Private data is deny-by-default across agent-site boundaries. A wildcard allow rule passes every field.",
    fix: "Replace \"*\" in allow.to_downstream.sly_data / to_upstream.sly_data with the exact field names." },
  "AW-P01": { level: "fail", section: "3.2", title: "Peer network URLs use HTTPS",
    why: "A peer network is identified by an HTTP(S) URL, and HTTPS is required outside local development.",
    fix: "Use the peer's https:// network URL." },
  "AW-P02": { level: "warn", section: "3.2", title: "Called peers are in the peer policy",
    why: "Peer-policy metadata states which origins may be contacted. A runtime with a closed policy refuses peers that are not listed.",
    fix: "Add each called peer's origin to allowed_peers in agent-manifest.json." },
  "AW-P03": { level: "warn", section: "2.1", title: "MCP tools are HTTPS and scoped",
    why: "An agent may reference an MCP server, and a descriptor may restrict the tool names the agent sees.",
    fix: "Use an https:// MCP URL and list the tool names the agent needs." },
  "AW-L01": { level: "warn", section: "3.3", title: "links.json is well formed",
    why: "links.json maps symbolic peer references to concrete network URLs for each local network.",
    fix: "Use {\"version\": 1, \"networks\": {\"<network>\": {\"<name>\": \"https://peer.example/agents/<network>\"}}}." },
  "AW-C01": { level: "warn", section: "5", title: "Coded-tool bundles carry an integrity digest",
    why: "When a manifest supplies an SRI digest, the runtime verifies it before running the bundle. A digest lets callers detect a changed bundle.",
    fix: "Add an integrity value (sha384-...) next to each coded-tool bundle in the manifest." },
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const NAME_RE = /^[A-Za-z0-9_-]+$/;
// Credential shapes. Only well-known prefixes, to keep false positives rare.
const SECRET_PATTERNS = [
  ["OpenAI-style key", /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/],
  ["Otari key", /\botk_[A-Za-z0-9_-]{16,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/],
];
const LOCAL_PATH_RE = /(?:^|["'\s(])(?:file:\/\/|\/home\/[^\s"']+|\/Users\/[^\s"']+|[A-Za-z]:\\\\?[^\s"']+)/;

/**
 * Work out what the visitor typed: a site base, a manifest URL or a network URL.
 *
 * :param input: The URL as typed.
 * :return: {base, network, manifestUrl} with base ending in "/".
 */
export function resolveTarget(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Enter the URL of an agentic website, its agent-manifest.json or a network URL.");
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  url.hash = "";
  url.search = "";
  let path = url.pathname;
  let network = null;
  if (/\/agent-manifest\.json$/i.test(path)) {
    path = path.replace(/agent-manifest\.json$/i, "");
  } else if (!path.endsWith("/")) {
    const last = path.slice(path.lastIndexOf("/") + 1);
    if (/\.network\.json$|\.json$|\.html?$/i.test(last)) {
      path = path.slice(0, path.lastIndexOf("/") + 1);
    } else {
      network = decodeURIComponent(last);
      path = path.slice(0, path.lastIndexOf("/") + 1);
    }
  }
  const base = `${url.origin}${path}`;
  return { base, network, manifestUrl: `${base}agent-manifest.json` };
}

/**
 * Inspect one agentic website.
 *
 * :param input: A site base, manifest URL or network URL.
 * :param options: fetchImpl (default global fetch); env "browser" or "node"; origin, the
 *   Origin header Node sends to test CORS (default https://caller.example).
 * :return: The report: target, files read, networks found, findings and a summary.
 */
export async function inspect(input, options = {}) {
  const run = new Inspection(options);
  return run.inspect(input);
}

class Inspection {
  constructor({ fetchImpl, env, origin, now } = {}) {
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.env = env || (typeof window === "undefined" ? "node" : "browser");
    this.origin = origin || "https://caller.example";
    this.now = now || (() => new Date().toISOString());
    this.findings = [];
    this.files = [];
    this.networks = [];
  }

  add(id, ok, detail, extra = {}) {
    const rule = RULES[id];
    this.findings.push({
      id,
      level: ok === true ? "pass" : ok === "info" ? "info" : rule.level,
      section: rule.section,
      title: rule.title,
      detail,
      ...(ok === true ? {} : { fix: rule.fix }),
      ...extra,
    });
  }

  async inspect(input) {
    const started = this.now();
    let target;
    try {
      target = resolveTarget(input);
    } catch (error) {
      return { ok: false, reason: error.message };
    }
    this.target = target;
    const host = new URL(target.base).hostname;
    const loopback = LOOPBACK.has(host);
    const https = target.base.startsWith("https://");
    this.add("AW-H01", https || loopback,
      https ? "The site base uses HTTPS." : loopback ? "Loopback HTTP is accepted for local development only." : `The site base ${target.base} uses plain HTTP.`);

    const manifestFile = await this.read(target.manifestUrl, "manifest");
    let manifest = null;
    if (!manifestFile.ok) {
      this.add("AW-M01", false, manifestFile.error);
    } else {
      this.add("AW-M01", true, `Read ${target.manifestUrl} (HTTP ${manifestFile.status}).`);
      try {
        manifest = JSON.parse(manifestFile.text);
        if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("The top level is not a JSON object.");
        this.add("AW-M02", true, "The manifest is a JSON object.");
      } catch (error) {
        this.add("AW-M02", false, `Could not parse the manifest: ${error.message}`);
        manifest = null;
      }
    }
    this.corsFinding();

    if (manifest) {
      await this.checkManifest(manifest);
      await this.checkLinks(manifest);
    }
    return this.report(started);
  }

  /**
   * Read one public file without credentials, and record what a browser would see.
   */
  async read(url, role) {
    const record = { url, role, status: null, cors: null, contentType: null, ms: null, ok: false };
    const t0 = Date.now();
    try {
      const init = { method: "GET", credentials: "omit", redirect: "follow", cache: "no-store" };
      if (this.env === "node") init.headers = { Origin: this.origin };
      const resp = await this.fetch(url, init);
      record.ms = Date.now() - t0;
      record.status = resp.status;
      record.contentType = resp.headers.get("content-type");
      if (this.env === "node") {
        record.cors = resp.headers.get("access-control-allow-origin");
        record.corsCredentials = resp.headers.get("access-control-allow-credentials");
      } else {
        // In a browser, a cross-origin response we can read was allowed by CORS.
        const sameOrigin = typeof location !== "undefined" && new URL(url).origin === location.origin;
        record.cors = sameOrigin ? "same-origin" : "allowed (read by this browser)";
      }
      const text = await resp.text();
      record.bytes = text.length;
      if (!resp.ok) {
        record.error = `HTTP ${resp.status} for ${url}.`;
      } else {
        record.ok = true;
      }
      this.files.push(record);
      return { ...record, text };
    } catch (error) {
      record.ms = Date.now() - t0;
      record.error = this.env === "browser"
        ? `This browser could not read ${url}. The file is missing, the host is down, or the host does not allow cross-origin reads (CORS).`
        : `Could not fetch ${url}: ${error.message}`;
      if (this.env === "browser" && await this.hostAnswers(url)) {
        // An opaque no-cors response means the host answered but the browser hid the body.
        record.corsBlocked = true;
        record.error = `The host answered for ${url}, but did not allow this page to read it: no Access-Control-Allow-Origin header that covers this origin (or the file is missing).`;
      }
      record.networkError = true;
      this.files.push(record);
      return record;
    }
  }

  async hostAnswers(url) {
    try {
      const resp = await this.fetch(url, { mode: "no-cors", credentials: "omit", cache: "no-store" });
      return resp.type === "opaque" || resp.status === 0 || resp.ok;
    } catch {
      return false;
    }
  }

  corsFinding() {
    const publicFiles = this.files.filter((f) => f.status && f.ok);
    if (this.env === "browser") {
      const blocked = this.files.filter((f) => f.networkError);
      const corsBlocked = blocked.filter((f) => f.corsBlocked);
      if (corsBlocked.length) {
        this.add("AW-H02", false, `${corsBlocked[0].error} Other agentic websites cannot load this network until the header is sent. The CLI (node cli/inspect.mjs <url>) prints the headers the host sends.`);
      } else if (blocked.length && !publicFiles.length) {
        this.add("AW-H02", false, `${blocked[0].error} Run the CLI (node cli/inspect.mjs <url>) to tell a missing file from a CORS refusal.`);
      } else if (publicFiles.length) {
        this.add("AW-H02", true, `This page, on another origin, read ${publicFiles.length} public file(s), so CORS allows them.`);
      }
      return;
    }
    if (!publicFiles.length) return;
    const bad = publicFiles.filter((f) => f.cors !== "*" && f.cors !== this.origin);
    this.add("AW-H02", bad.length === 0,
      bad.length === 0
        ? `Every public file sent Access-Control-Allow-Origin (${publicFiles.map((f) => f.cors).filter((v, i, a) => a.indexOf(v) === i).join(", ")}).`
        : `No Access-Control-Allow-Origin header allowing ${this.origin} on: ${bad.map((f) => f.url).join(", ")}.`);
    const creds = publicFiles.filter((f) => String(f.corsCredentials).toLowerCase() === "true");
    this.add("AW-H03", creds.length === 0,
      creds.length === 0 ? "Public files do not ask for credentials." : `Access-Control-Allow-Credentials: true on ${creds.map((f) => f.url).join(", ")}.`);
  }

  async checkManifest(manifest) {
    const nets = Array.isArray(manifest.networks) ? manifest.networks : [];
    const complete = nets.filter((n) => n && typeof n.name === "string" && n.name && typeof n.front_man === "string" && n.front_man && typeof n.hocon === "string" && n.hocon);
    this.add("AW-M03", nets.length > 0 && complete.length === nets.length,
      nets.length === 0 ? "The manifest has no networks array, or it is empty."
        : complete.length === nets.length ? `${nets.length} network(s): ${nets.map((n) => n.name).join(", ")}.`
          : `${nets.length - complete.length} of ${nets.length} network entries miss name, front_man or hocon.`);

    const names = nets.filter((n) => n && typeof n.name === "string" && n.name).map((n) => n.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    const odd = names.filter((n) => !NAME_RE.test(n));
    let nameOk = dupes.length === 0 && odd.length === 0;
    let nameDetail = dupes.length ? `Duplicate network names: ${[...new Set(dupes)].join(", ")}.`
      : odd.length ? `Names that cannot be the last part of a URL as-is: ${odd.join(", ")}.` : "Every network name is unique and URL-safe.";
    if (this.target.network && !names.includes(this.target.network)) {
      nameOk = false;
      nameDetail = `The URL asks for network "${this.target.network}", but the manifest has no network with exactly that name (it has: ${names.join(", ") || "none"}). A runtime must fail here.`;
    }
    this.add("AW-M04", nameOk, nameDetail);

    const router = manifest.llm_router;
    this.add("AW-M05", Boolean(router && (router.base_url || router.byok_router || router.mock)),
      router ? `Router: ${router.base_url || "(none)"}${router.byok_router ? `, BYOK: ${router.byok_router}` : ""}.` : "No llm_router in the manifest.");

    const policy = manifest.peer_policy;
    this.peerPolicy = {
      mode: policy?.mode || (Array.isArray(manifest.allowed_peers) ? "closed" : "unknown"),
      allowed: Array.isArray(manifest.allowed_peers) ? manifest.allowed_peers.map(String) : [],
      deny: Array.isArray(policy?.deny_origins) ? policy.deny_origins.map(String) : [],
    };
    this.add("AW-M06", Boolean(policy || Array.isArray(manifest.allowed_peers)),
      policy || manifest.allowed_peers ? `Peer policy "${this.peerPolicy.mode}", ${this.peerPolicy.allowed.length} allowed peer origin(s).` : "No peer_policy or allowed_peers in the manifest.");

    this.codedToolFindings(manifest);

    const wanted = this.target.network ? complete.filter((n) => n.name === this.target.network) : complete;
    for (const entry of wanted) {
      await this.checkNetwork(entry);
    }
  }

  codedToolFindings(manifest) {
    const bundles = [];
    const visit = (value, path) => {
      if (!value || typeof value !== "object") return;
      if (typeof value.bundle === "string") bundles.push({ path, bundle: value.bundle, integrity: value.integrity || value.sri || null });
      for (const [k, v] of Object.entries(value)) visit(v, `${path}.${k}`);
    };
    visit(manifest.coded_tools || manifest.codedTools, "coded_tools");
    for (const net of manifest.networks || []) visit(net?.coded_tools || net?.codedTools, `networks.${net?.name}.coded_tools`);
    if (!bundles.length) return;
    const missing = bundles.filter((b) => !b.integrity);
    this.add("AW-C01", missing.length === 0,
      missing.length === 0 ? `${bundles.length} coded-tool bundle(s), each with an integrity digest.` : `No integrity digest for: ${missing.map((b) => b.bundle).join(", ")}.`);
  }

  async checkNetwork(entry) {
    const url = new URL(entry.hocon, this.target.base).href;
    const summary = { name: entry.name, front_man: entry.front_man, url, networkUrl: `${this.target.base}${entry.name}`, agents: [], peers: [], mcps: [], ok: false };
    this.networks.push(summary);
    const file = await this.read(url, "network");
    const tag = { network: entry.name };
    if (!file.ok) {
      this.add("AW-N01", false, file.error, tag);
      return;
    }
    this.add("AW-N01", true, `Read ${url} (HTTP ${file.status}, ${file.bytes} bytes).`, tag);
    if (new URL(url).protocol !== "https:" && !LOOPBACK.has(new URL(url).hostname)) {
      this.add("AW-H01", false, `The network file ${url} uses plain HTTP.`, tag);
    }

    let config;
    try {
      config = /\.json$/i.test(new URL(url).pathname) ? JSON.parse(file.text) : parseHocon(file.text);
      if (!config || typeof config !== "object" || !Array.isArray(config.tools)) throw new Error("It has no top-level tools array of agents.");
      this.add("AW-N02", true, "The definition parses and has a tools array.", tag);
    } catch (error) {
      this.add("AW-N02", false, `Could not parse the definition: ${error.message}`, tag);
      return;
    }

    this.dataOnlyFindings(file.text, tag);
    this.secretFindings(file.text, url, tag);

    const network = new AgentNetwork(config, entry.name);
    const result = validateNetwork(network);
    this.add("AW-N03", result.errors.length === 0,
      result.errors.length === 0 ? "No errors from the reference runtime's validator." : result.errors.join(" "), tag);

    const agents = network.config.tools.filter((a) => a && typeof a.name === "string");
    this.add("AW-N04", Boolean(network.getAgentSpec(entry.front_man)),
      network.getAgentSpec(entry.front_man) ? `Front agent "${entry.front_man}" is defined.` : `front_man "${entry.front_man}" is not an agent in this network (agents: ${agents.map((a) => a.name).join(", ")}).`, tag);
    this.add("AW-N05", Boolean(network.config.metadata?.description),
      network.config.metadata?.description ? `"${String(network.config.metadata.description).slice(0, 120)}"` : "No metadata.description.", tag);

    const noDesc = [];
    const noInstr = [];
    const noSchema = [];
    const wildcard = [];
    for (const agent of agents) {
      const coded = typeof agent.class === "string" || typeof agent.toolbox === "string";
      if (!agent.function?.description) noDesc.push(agent.name);
      if (!coded && !agent.instructions) noInstr.push(agent.name);
      const params = agent.function?.parameters;
      if (!(params && typeof params === "object" && (params.type === "object" || params.properties))) noSchema.push(agent.name);
      for (const dir of ["to_downstream", "to_upstream"]) {
        const allowed = agent.allow?.[dir]?.sly_data;
        if ((Array.isArray(allowed) && allowed.includes("*")) || allowed === "*" || allowed === true) wildcard.push(`${agent.name} (${dir})`);
      }
      const tools = Array.isArray(agent.tools) ? agent.tools : [];
      const kinds = tools.map((ref) => this.classify(network, ref));
      summary.agents.push({ name: agent.name, description: agent.function?.description || "", front: agent.name === entry.front_man, tools: kinds });
      for (const k of kinds) {
        if (k.kind === "peer") summary.peers.push({ from: agent.name, url: k.url, origin: k.origin });
        if (k.kind === "mcp") summary.mcps.push({ from: agent.name, url: k.url, tools: k.tools });
      }
    }
    this.add("AW-N06", noDesc.length === 0, noDesc.length ? `No function.description on: ${noDesc.join(", ")}.` : `All ${agents.length} agent(s) describe what they do.`, tag);
    this.add("AW-N07", noInstr.length === 0, noInstr.length ? `No instructions on: ${noInstr.join(", ")}.` : "Every LLM agent has instructions.", tag);
    this.add("AW-N08", noSchema.length === 0, noSchema.length ? `No object input schema on: ${noSchema.join(", ")}.` : "Every agent declares an object input schema.", tag);
    this.add("AW-N11", wildcard.length === 0, wildcard.length ? `Wildcard sly_data allow rule on: ${wildcard.join(", ")}.` : "No wildcard private-context rules.", tag);

    this.peerFindings(summary, tag);
    summary.ok = !this.findings.some((f) => f.network === entry.name && f.level === "fail");
  }

  classify(network, ref) {
    if (ref && typeof ref === "object") {
      const url = String(ref.url || "");
      return { kind: "mcp", url, tools: Array.isArray(ref.tools) ? ref.tools : null };
    }
    const kind = network.classifyTool(ref).kind;
    if (typeof ref === "string" && /^https?:\/\//i.test(ref)) {
      if (isMcpTool(ref)) return { kind: "mcp", url: ref, tools: null };
      const u = new URL(ref);
      return { kind: "peer", url: ref, origin: u.origin };
    }
    if (typeof ref === "string" && ref.startsWith("/")) {
      const url = new URL(ref, this.target.base).href;
      return { kind: "peer", url, origin: new URL(url).origin };
    }
    return { kind: kind === "missing" ? "missing" : kind === "link" ? "link" : "agent", ref };
  }

  peerFindings(summary, tag) {
    const peers = summary.peers;
    const insecure = peers.filter((p) => !p.url.startsWith("https://") && !LOOPBACK.has(new URL(p.url).hostname));
    if (peers.length) {
      this.add("AW-P01", insecure.length === 0, insecure.length ? `Plain-HTTP peer URLs: ${insecure.map((p) => p.url).join(", ")}.` : `${peers.length} peer network reference(s), all HTTPS.`, tag);
      const own = new URL(this.target.base).origin;
      const policy = this.peerPolicy || { mode: "unknown", allowed: [], deny: [] };
      const outside = peers.filter((p) => p.origin !== own && policy.mode !== "open" && !policy.allowed.some((a) => a.replace(/\/$/, "") === p.origin));
      this.add("AW-P02", outside.length === 0,
        outside.length ? `Called but not in allowed_peers: ${[...new Set(outside.map((p) => p.origin))].join(", ")}.` : "Every called peer origin is covered by the peer policy.", tag);
    }
    const mcps = summary.mcps;
    if (mcps.length) {
      const bad = mcps.filter((m) => !/^https:\/\//i.test(m.url) && !(m.url && LOOPBACK.has(new URL(m.url).hostname)));
      const unscoped = mcps.filter((m) => !m.tools || !m.tools.length);
      this.add("AW-P03", bad.length === 0 && unscoped.length === 0,
        bad.length ? `MCP servers without HTTPS: ${bad.map((m) => m.url || "(no url)").join(", ")}.`
          : unscoped.length ? `MCP servers that expose every tool: ${unscoped.map((m) => m.url).join(", ")}.` : `${mcps.length} MCP reference(s), HTTPS and scoped.`, tag);
    }
  }

  dataOnlyFindings(text, tag) {
    const problems = [];
    if (/\$\{[^}]+\}/.test(text)) problems.push("an unresolved ${...} substitution");
    if (/(^|\n)\s*include\s*(required\()?\s*["(]/.test(text)) problems.push("an include directive");
    const local = text.match(LOCAL_PATH_RE);
    if (local) problems.push(`a local file path (${local[0].trim().slice(0, 60)})`);
    this.add("AW-N09", problems.length === 0, problems.length ? `The published definition contains ${problems.join(", ")}.` : "No includes, substitutions or local paths.", tag);
  }

  secretFindings(text, url, tag) {
    const hits = [];
    for (const [label, re] of SECRET_PATTERNS) {
      const m = text.match(re);
      if (m) hits.push(`${label} (${m[0].slice(0, 6)}…${m[0].length} chars)`);
    }
    this.add("AW-N10", hits.length === 0, hits.length ? `Possible credential in ${url}: ${hits.join(", ")}. Shown masked.` : "No credential-shaped strings.", tag);
  }

  async checkLinks(manifest) {
    const url = `${this.target.base}links.json`;
    const file = await this.read(url, "links");
    if (!file.ok) {
      // links.json is needed only for named peer references. A missing file is fine.
      this.files[this.files.length - 1].optional = true;
      return;
    }
    let data = null;
    try { data = JSON.parse(file.text); } catch (error) {
      this.add("AW-L01", false, `links.json is not valid JSON: ${error.message}`);
      return;
    }
    const problems = [];
    if (!data || typeof data !== "object") problems.push("it is not an object");
    else {
      if (data.version !== undefined && typeof data.version !== "number") problems.push("version is not a number");
      if (!data.networks || typeof data.networks !== "object") problems.push("it has no networks object");
      else {
        const known = new Set((manifest.networks || []).map((n) => n?.name));
        for (const [net, map] of Object.entries(data.networks)) {
          if (!known.has(net)) problems.push(`"${net}" is not a network in the manifest`);
          for (const [name, target] of Object.entries(map || {})) {
            if (typeof target !== "string" || !/^https?:\/\//i.test(target)) problems.push(`${net}.${name} is not an http(s) URL`);
          }
        }
      }
    }
    this.add("AW-L01", problems.length === 0, problems.length ? `links.json: ${problems.join("; ")}.` : "links.json maps every name to an http(s) network URL.");
  }

  report(started) {
    const order = { fail: 0, warn: 1, info: 2, pass: 3 };
    this.findings.sort((a, b) => order[a.level] - order[b.level] || a.id.localeCompare(b.id));
    const count = (level) => this.findings.filter((f) => f.level === level).length;
    const summary = { fail: count("fail"), warn: count("warn"), pass: count("pass"), info: count("info") };
    const verdict = summary.fail ? "not conformant" : summary.warn ? "conformant with warnings" : "conformant";
    return {
      ok: true,
      tool: "Agent Site Inspector",
      spec: SPEC,
      target: this.target,
      environment: this.env,
      checkedAt: started,
      verdict,
      summary,
      networks: this.networks,
      files: this.files,
      findings: this.findings,
    };
  }
}
