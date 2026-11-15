// Registers the Inspector page's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
//
// Each action wraps a method of the page object in inspector.js, the same methods the
// page's own form and buttons call. No rule is copied here.
import { App } from "./inspector.js";
import { RULES } from "./checks.js";

/**
 * Describes the Inspector's operations as actions the agents can call.
 */
class SiteActions {
  /**
   * Register every site action with the runtime.
   *
   * :param actions: The runtime registry facade with a register(definition) method.
   */
  static registerActions(actions) {
    actions.register(SiteActions.readStateAction());
    actions.register(SiteActions.rulesAction());
    actions.register(SiteActions.inspectAction());
  }

  /**
   * The read action: last report, recent inspections, samples and limits.
   */
  static readStateAction() {
    return {
      name: "get_inspector_state",
      description: "Read the last inspection report on this page (verdict, counts, failing and warning findings with fixes, networks with their agents, peers and MCP servers), recent inspections, sample sites to try, and this tool's limits.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => App.page.getState(),
    };
  }

  /**
   * The rule catalog lookup.
   */
  static rulesAction() {
    return {
      name: "get_rules",
      description: "Look up the inspector's rules: by rule id (such as AW-H02), by spec section (such as 3.2), or all rules when both are empty. Each rule has its level, spec section, title, why it matters, the fix and a link to the spec section.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", enum: Object.keys(RULES), description: "A rule id from a report, such as AW-N03." },
          section: { type: "string", enum: [...new Set(Object.values(RULES).map((r) => r.section))].sort(), description: "A spec section number, such as 3.3." },
        },
      },
      execute: (args) => App.page.getRules(args || {}),
    };
  }

  /**
   * The inspection. It only reads another site's public files, but it contacts that
   * site's origin, so the visitor confirms it first (MVP spec 3.2, consent before contact).
   * The runtime opens the confirmation dialog only for "irreversible" actions, so that is
   * the effect used here.
   */
  static inspectAction() {
    return {
      name: "inspect_site",
      description: "Inspect an open agentic website: read its agent-manifest.json, network definitions and links.json with GET and no credentials, and check them against the MVP spec. The browser asks the visitor before contacting the site. Returns the report: verdict, counts, failing and warning findings with fixes, and networks.",
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: {
          url: { type: "string", minLength: 4, maxLength: 500, description: "The exact URL the visitor gave: a site base, an agent-manifest.json URL or a network URL." },
        },
      },
      execute: (args) => App.page.inspect(args.url),
    };
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;
