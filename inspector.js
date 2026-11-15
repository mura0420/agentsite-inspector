// inspector.js — the Inspector page: the form, the report and the page object that the
// buttons and the assistant share (App.page). Business rules live in checks.js.
import { inspect, resolveTarget, RULES, SPEC } from "./checks.js";
import { badgeSvg } from "./badge.js";

const SECTION_ANCHORS = {
  "2": "2-tenet-one-common-multi-agent-representation",
  "2.1": "21-minimum-network-content",
  "2.2": "22-portable-data-profile",
  "3.1": "31-minimum-runtime-behavior",
  "3.2": "32-protocol-for-loading-a-peer-agent-site",
  "3.3": "33-minimum-public-files",
  "3.4": "34-browser-origin-requirements",
  "4": "4-tenet-three-pluggable-inference",
  "5": "5-cross-cutting-security-and-privacy-requirements",
};

/**
 * The page's state and operations. The page's own form and the assistant's actions both
 * call these methods, so they follow the same rules.
 */
class InspectorPage {
  constructor() {
    this.report = null;
    this.history = [];
    this.running = null;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  /**
   * Check whether a URL can be inspected, without contacting it.
   *
   * :param url: What the visitor typed.
   * :return: {ok: true, base, origin, network} or {ok: false, reason}.
   */
  checkTarget(url) {
    try {
      const target = resolveTarget(url);
      return { ok: true, base: target.base, origin: new URL(target.base).origin, network: target.network, manifestUrl: target.manifestUrl };
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  }

  /**
   * Inspect a site and keep the report. Reads only public files, without credentials.
   *
   * :param url: A site base, manifest URL or network URL.
   * :return: A compact report for the assistant, or {ok: false, reason}.
   */
  async inspect(url) {
    const target = this.checkTarget(url);
    if (!target.ok) return target;
    this.running = target.base;
    this.emit();
    try {
      const report = await inspect(url, { env: "browser" });
      if (!report.ok) return report;
      this.report = report;
      this.history = [{ url: String(url).trim(), verdict: report.verdict, summary: report.summary, checkedAt: report.checkedAt },
        ...this.history.filter((h) => h.url !== String(url).trim())].slice(0, 8);
      return InspectorPage.compact(report);
    } finally {
      this.running = null;
      this.emit();
    }
  }

  /**
   * The current page state, as plain data for the assistant.
   */
  getState() {
    return {
      spec: SPEC,
      pageUrl: typeof location !== "undefined" ? location.href.split("?")[0] : null,
      lastReport: this.report ? InspectorPage.compact(this.report) : null,
      history: this.history,
      ruleCount: Object.keys(RULES).length,
      samples: InspectorPage.samples(),
      limits: [
        "Reads only public files with GET and no credentials; it never logs in or writes anything.",
        "In a browser, a missing file and a CORS refusal look the same; the CLI (node cli/inspect.mjs) tells them apart.",
        "Checks published files only. It does not run the site's agents, call its LLM router or test its runtime behavior.",
        "It never contacts a peer network by itself. Each peer is a separate inspection the visitor approves.",
      ],
    };
  }

  /**
   * Look up rules by id or by spec section.
   *
   * :param query: {id} or {section}; empty returns every rule.
   */
  getRules({ id, section } = {}) {
    const all = Object.entries(RULES).map(([ruleId, r]) => ({ id: ruleId, ...r, specUrl: InspectorPage.specUrl(r.section) }));
    if (id) {
      const rule = all.find((r) => r.id === id);
      return rule ? { ok: true, rules: [rule] } : { ok: false, reason: `No rule ${id}. Rule ids look like AW-N03.` };
    }
    if (section) return { ok: true, rules: all.filter((r) => r.section === section || r.section.startsWith(`${section}.`)) };
    return { ok: true, rules: all };
  }

  static samples() {
    const here = typeof location !== "undefined" ? new URL("./", location.href).href : "./";
    return [
      { label: "This site", url: here },
      { label: "Sample: conformant", url: `${here}samples/good/` },
      { label: "Sample: broken", url: `${here}samples/broken/` },
    ];
  }

  static specUrl(section) {
    return `${SPEC.url}#${SECTION_ANCHORS[section] || ""}`;
  }

  /**
   * A small copy of a report: failing and warning findings in full, passes by id only.
   */
  static compact(report) {
    return {
      target: report.target,
      verdict: report.verdict,
      summary: report.summary,
      checkedAt: report.checkedAt,
      problems: report.findings.filter((f) => f.level === "fail" || f.level === "warn")
        .map(({ id, level, section, title, detail, fix, network }) => ({ id, level, section, title, detail, fix, network })),
      passed: report.findings.filter((f) => f.level === "pass").map((f) => (f.network ? `${f.id} [${f.network}]` : f.id)),
      networks: report.networks.map((n) => ({
        name: n.name,
        networkUrl: n.networkUrl,
        front_man: n.front_man,
        agents: n.agents.map((a) => ({ name: a.name, front: a.front, calls: a.tools.map((t) => t.ref || t.url) })),
        peers: n.peers,
        mcps: n.mcps,
      })),
    };
  }
}

/**
 * Renders the page and wires its controls to App.page.
 */
export class App {
  static page = new InspectorPage();

  static start() {
    const form = document.querySelector("#inspect-form");
    const input = document.querySelector("#target");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      App.run(input.value);
    });
    const samples = document.querySelector("#samples");
    for (const sample of InspectorPage.samples()) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = sample.label;
      b.addEventListener("click", () => {
        input.value = sample.url;
        App.run(sample.url);
      });
      samples.append(b);
    }
    App.page.onChange(App.render);
    const fromQuery = new URLSearchParams(location.search).get("url");
    if (fromQuery) {
      input.value = fromQuery;
      App.run(fromQuery);
    }
    App.render(App.page);
  }

  static async run(url) {
    const result = await App.page.inspect(url);
    const status = document.querySelector("#inspect-status");
    if (!result.ok && result.reason) status.textContent = result.reason;
    if (App.page.report) {
      const share = new URL(location.href);
      share.searchParams.set("url", String(url).trim());
      history.replaceState(null, "", share);
    }
  }

  static render(page) {
    const status = document.querySelector("#inspect-status");
    const button = document.querySelector("#inspect-button");
    button.disabled = Boolean(page.running);
    status.textContent = page.running ? `Reading public agent files from ${page.running} …` : "";
    const out = document.querySelector("#report");
    const report = page.report;
    if (!report) {
      out.hidden = true;
      return;
    }
    out.hidden = false;
    out.replaceChildren(App.verdictBlock(report), App.mapBlock(report), App.findingsBlock(report), App.filesBlock(report), App.exportBlock(report));
  }

  static el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c);
    return node;
  }

  static verdictBlock(report) {
    const s = report.summary;
    const tone = s.fail ? "fail" : s.warn ? "warn" : "pass";
    return App.el("section", { class: `verdict ${tone}`, "aria-live": "polite" },
      App.el("div", { class: "verdict-main" },
        App.el("span", { class: "verdict-label" }, report.verdict),
        App.el("span", { class: "verdict-target" }, report.target.base + (report.target.network || ""))),
      App.el("div", { class: "counts" },
        App.el("span", { class: "count fail" }, `${s.fail} fail`),
        App.el("span", { class: "count warn" }, `${s.warn} warn`),
        App.el("span", { class: "count pass" }, `${s.pass} pass`)),
      App.el("p", { class: "verdict-note" }, `Checked against ${report.spec.version} at ${new Date(report.checkedAt).toLocaleString()}.`));
  }

  static mapBlock(report) {
    const wrap = App.el("section", { class: "card" }, App.el("h3", {}, "Agent network map"));
    if (!report.networks.length) {
      wrap.append(App.el("p", { class: "muted" }, "No network definition could be read."));
      return wrap;
    }
    for (const net of report.networks) {
      wrap.append(App.el("p", { class: "net-title" }, App.el("strong", {}, net.name), " · ", App.el("code", {}, net.networkUrl)));
      wrap.append(App.networkSvg(net));
      if (net.peers.length) {
        const list = App.el("ul", { class: "peers" });
        for (const peer of net.peers) {
          list.append(App.el("li", {},
            App.el("code", {}, peer.url), " ",
            App.el("button", { type: "button", class: "chip small", onclick: () => { document.querySelector("#target").value = peer.url; App.run(peer.url); } }, `Inspect peer (contacts ${new URL(peer.url).host})`)));
        }
        wrap.append(App.el("p", { class: "muted" }, "Peer networks are listed, not fetched. Inspecting one contacts its origin, so it is your choice."), list);
      }
    }
    return wrap;
  }

  static networkSvg(net) {
    const ns = "http://www.w3.org/2000/svg";
    const agents = net.agents;
    const externals = [];
    for (const a of agents) for (const t of a.tools) if (t.kind !== "agent") externals.push({ from: a.name, ...t });
    const colW = 230;
    const rowH = 54;
    const rows = Math.max(agents.length, externals.length, 1);
    const width = externals.length ? colW * 2 + 160 : colW + 70;
    const height = rows * rowH + 20;
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("class", "netmap");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Agents in ${net.name}: ${agents.map((a) => a.name).join(", ")}`);
    const pos = new Map();
    agents.forEach((a, i) => pos.set(a.name, { x: 50, y: 10 + i * rowH }));
    externals.forEach((e, i) => pos.set(`ext:${i}`, { x: colW + 130, y: 10 + i * rowH }));
    const line = (x1, y1, x2, y2, cls) => {
      const p = document.createElementNS(ns, "path");
      const mx = (x1 + x2) / 2;
      p.setAttribute("d", x1 === x2 ? `M${x1} ${y1} C ${x1 - 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}` : `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
      p.setAttribute("class", `edge ${cls}`);
      svg.append(p);
    };
    for (const a of agents) {
      const from = pos.get(a.name);
      for (const t of a.tools) {
        if (t.kind === "agent" && pos.has(t.ref)) {
          const to = pos.get(t.ref);
          line(from.x, from.y + 20, to.x, to.y + 20, "internal");
        }
      }
    }
    externals.forEach((e, i) => {
      const from = pos.get(e.from);
      const to = pos.get(`ext:${i}`);
      line(from.x + colW - 20, from.y + 20, to.x, to.y + 20, e.kind);
    });
    const box = (p, title, sub, cls) => {
      const g = document.createElementNS(ns, "g");
      g.setAttribute("class", `node ${cls}`);
      const r = document.createElementNS(ns, "rect");
      r.setAttribute("x", p.x);
      r.setAttribute("y", p.y);
      r.setAttribute("width", colW - 20);
      r.setAttribute("height", 40);
      r.setAttribute("rx", 8);
      const t1 = document.createElementNS(ns, "text");
      t1.setAttribute("x", p.x + 10);
      t1.setAttribute("y", p.y + 17);
      t1.textContent = title.length > 30 ? `${title.slice(0, 29)}…` : title;
      const t2 = document.createElementNS(ns, "text");
      t2.setAttribute("x", p.x + 10);
      t2.setAttribute("y", p.y + 32);
      t2.setAttribute("class", "sub");
      t2.textContent = sub.length > 34 ? `${sub.slice(0, 33)}…` : sub;
      g.append(r, t1, t2);
      svg.append(g);
    };
    for (const a of agents) box(pos.get(a.name), a.name, a.front ? "front agent" : a.tools.length ? `calls ${a.tools.length}` : "agent", a.front ? "front" : "agent");
    externals.forEach((e, i) => {
      const label = e.kind === "peer" ? new URL(e.url).host : e.kind === "mcp" ? (e.url ? new URL(e.url).host : "MCP") : String(e.ref);
      const sub = e.kind === "peer" ? `peer · ${new URL(e.url).pathname}` : e.kind === "mcp" ? `MCP · ${e.tools ? e.tools.join(", ") : "all tools"}` : e.kind;
      box(pos.get(`ext:${i}`), label, sub, e.kind);
    });
    return svg;
  }

  static findingsBlock(report) {
    const wrap = App.el("section", { class: "card" }, App.el("h3", {}, "Findings"));
    for (const level of ["fail", "warn", "pass"]) {
      const items = report.findings.filter((f) => f.level === level);
      if (!items.length) continue;
      const det = App.el("details", { class: `group ${level}` });
      if (level !== "pass") det.open = true;
      det.append(App.el("summary", {}, `${level.toUpperCase()} · ${items.length}`));
      for (const f of items) {
        det.append(App.el("div", { class: `finding ${level}` },
          App.el("div", { class: "finding-head" },
            App.el("code", { class: "rule" }, f.id),
            App.el("span", { class: "title" }, f.title),
            f.network ? App.el("span", { class: "tag" }, f.network) : null,
            App.el("a", { class: "section", href: InspectorPage.specUrl(f.section), target: "_blank", rel: "noopener" }, `spec §${f.section}`)),
          App.el("p", { class: "detail" }, f.detail),
          f.fix ? App.el("p", { class: "fix" }, App.el("strong", {}, "Fix: "), f.fix) : null));
      }
      wrap.append(det);
    }
    return wrap;
  }

  static filesBlock(report) {
    const rows = report.files.map((f) => App.el("tr", {},
      App.el("td", {}, f.role),
      App.el("td", {}, App.el("code", {}, f.url)),
      App.el("td", {}, f.status ? String(f.status) : "—"),
      App.el("td", {}, f.optional ? "optional, not published" : f.cors || "—"),
      App.el("td", {}, f.ms !== null ? `${f.ms} ms` : "—")));
    return App.el("section", { class: "card" }, App.el("h3", {}, "Files read"),
      App.el("p", { class: "muted" }, "GET only, without cookies or credentials."),
      App.el("div", { class: "table-wrap" }, App.el("table", {},
        App.el("thead", {}, App.el("tr", {}, ["File", "URL", "HTTP", "CORS", "Time"].map((h) => App.el("th", {}, h)))),
        App.el("tbody", {}, rows))));
  }

  static exportBlock(report) {
    const download = (name, type, text) => {
      const a = App.el("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    return App.el("section", { class: "card export" }, App.el("h3", {}, "Share and automate"),
      App.el("p", {}, "This page's address now includes the inspected URL, so you can share the report. Run the same checks in CI with ",
        App.el("code", {}, "node cli/inspect.mjs <url> --badge badge.svg"), "."),
      App.el("div", { class: "row" },
        App.el("button", { type: "button", onclick: () => download("agentic-web-report.json", "application/json", JSON.stringify(report, null, 2)) }, "Download JSON report"),
        App.el("button", { type: "button", onclick: () => download("agentic-web-badge.svg", "image/svg+xml", badgeSvg(report)) }, "Download badge")));
  }
}

if (typeof window !== "undefined" && document.querySelector("#inspect-form")) {
  App.start();
}
