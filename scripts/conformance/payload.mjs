/**
 * DualTran conformance payload generator (SPEC 2.0.0).
 *
 * Every value below is produced by driving the add-on's real settings surface:
 * Core.gs project helpers, Code.gs getPanelData()/saveAndTranslate(), and the DOM the
 * Sidebar.html script builds against. The generator only shims the Apps Script services
 * (see gs-shim.mjs); it never re-implements a product rule.
 */
import { readRepoFile } from "./gs-shim.mjs";
import { loadAddon } from "./gs-shim.mjs";

export const SPEC_VERSION = "2.0.0";

const HOST = "dualtran-gdocs";

/** Facts the add-on ships with: models.dev projection (offline snapshot) + language names. */
export function facts() {
  const catalog = JSON.parse(readRepoFile("tests/fixtures/conformance/models-dev-sample.json"));
  const languages = JSON.parse(readRepoFile("tests/fixtures/conformance/language-names.json"));
  const aliases = JSON.parse(readRepoFile("tests/fixtures/conformance/provider-aliases.json"));
  return { catalog, languages, aliases };
}

/**
 * Minimal DOM for Sidebar.html: enough of the API the page script uses (getElementById,
 * value, options, listeners, dataset) to run `renderPanel()` and observe the options it
 * writes, then fire real `change` events at it.
 */
export class FakeSelect {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.options = [];
    this.listeners = {};
    this.hidden = false;
    this.textContent = "";
    this.disabled = false;
  }

  get selectedIndex() {
    return Math.max(0, this.options.findIndex((option) => String(option.value) === String(this.value)));
  }

  set selectedIndex(index) {
    if (index >= 0 && index < this.options.length) this.value = String(this.options[index].value);
  }

  set innerHTML(_ignored) {
    this.options = [];
  }

  get innerHTML() {
    return "";
  }

  /** A DOM label/heading: the page writes textContent, tests read it back. */
  set textContent(value) {
    this.labelText = String(value);
  }

  get textContent() {
    return this.labelText || "";
  }

  getAttribute(name) {
    return name === "id" ? this.id : null;
  }

  appendChild(option) {
    // A DOM <option> keeps `label` (attribute) and `text`/`textContent` (content) in
    // sync; mirror that so the sidebar sets either one and readers see both.
    const row = {
      value: String(option.value ?? ""),
      label: String(option.label ?? option.textContent ?? option.text ?? option.value ?? ""),
    };
    this.options.push(row);
    if (this.options.length === 1) this.value = row.value;
    return option;
  }

  addEventListener(type, handler) {
    (this.listeners[type] = this.listeners[type] || []).push(handler);
  }

  fire(type) {
    for (const handler of this.listeners[type] || []) handler.call(this, { target: this });
  }
}

export function createPanelDom(ids) {
  const elements = new Map(ids.map((id) => [id, new FakeSelect(id)]));
  const document = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, new FakeSelect(id));
      return elements.get(id);
    },
    /** Sidebar.html marks every label with data-i18n; the harness renders them all. */
    querySelectorAll: (selector) =>
      selector === "[data-i18n]"
        ? ids
            .filter((id) => id !== "status")
            .map((id) => ({
              getAttribute: () => id,
              set textContent(value) {
                const node = elements.get(id);
                node.labelText = value;
              },
            }))
        : [],
    createElement: (tag) => (tag === "option" ? { value: "", textContent: "" } : {}),
  };
  return { document, elements };
}

/** Run Sidebar.html's inline script against our DOM and expose its functions. */
export function loadSidebar({ document, t }) {
  const html = readRepoFile("Sidebar.html");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  if (scripts.length === 0) throw new Error("Sidebar.html has no inline <script>");
  const source = scripts.join("\n");
  const api = new Function("document", "google", `${source}\nreturn {
    renderPanel: typeof renderPanel === "function" ? renderPanel : null,
    collect: typeof collect === "function" ? collect : null,
    onProviderChange: typeof onProviderChange === "function" ? onProviderChange : null,
    currentPanel: typeof currentPanel !== "undefined" ? currentPanel : null,
  };`)(document, {
    script: {
      run: { withSuccessHandler: () => ({ withFailureHandler: () => ({ getPanelData() {} }) }), saveAndTranslate() {} },
    },
  });
  api.t = t;
  return api;
}

function controlOf(id, html) {
  const tag = new RegExp(`<(select|input)\\b[^>]*\\bid="${id}"`, "i").exec(html);
  if (!tag) return "missing";
  if (tag[1].toLowerCase() === "select") return "select";
  const type = /\btype="([^"]+)"/i.exec(tag[0]);
  return (type ? type[1] : "text").toLowerCase();
}

function optionsOf(select) {
  return (select.options || []).map((option) => ({
    value: String(option.value ?? ""),
    label: String(option.label ?? option.text ?? option.value ?? ""),
    ...(option.source ? { source: option.source } : {}),
    ...(option.disabled ? { disabled: true } : {}),
  }));
}

function reasoningCases(resolve, levels) {
  const run = (options) => resolve("lowest", options);
  return {
    none: [{ setting: "lowest", options: ["none", "minimal", "low"], value: run(["none", "minimal", "low"]) }],
    minimal: [{ setting: "lowest", options: ["minimal", "low"], value: run(["minimal", "low"]) }],
    low: [{ setting: "lowest", options: ["low", "medium"], value: run(["low", "medium"]) }],
    "none-declared": [{ setting: "lowest", options: [], value: run([]) }],
    levels,
  };
}

export async function buildPayload() {
  const { catalog, languages } = facts();
  const html = readRepoFile("Sidebar.html");

  // ── Drive the real server surface ────────────────────────────────────────
  const addon = loadAddon({
    locale: "zh_TW",
    fetchImpl: () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify(catalog),
    }),
  });
  const g = addon.sandbox;
  const panel = g.getPanelData();
  const settings = panel.settings;

  // The sidebar script, running against a DOM with the ids Sidebar.html declares.
  const panelDom = createPanelDom([
    "engine",
    "target",
    "provider",
    "model",
    "endpoint",
    "reasoning",
    "apiKey",
    "run",
    "status",
    "ai-fields",
  ]);
  const sidebar = loadSidebar({ document: panelDom.document, t: panel.ui });
  if (!sidebar.renderPanel) throw new Error("Sidebar.html must expose renderPanel(panel)");
  sidebar.renderPanel(panel);

  const el = (id) => panelDom.elements.get(id);

  // R1 — target language picker, as rendered.
  const language = {
    control: controlOf("target", html),
    current: el("target").value,
    options: optionsOf(el("target")),
  };

  // R2 — provider picker + per-provider model lists, as rendered.
  const providerSelect = el("provider");
  const provider = {
    control: controlOf("provider", html),
    current: providerSelect.value,
    // `source` is not a DOM concept: it comes from the same rows the picker was built from.
    options: optionsOf(providerSelect).map((option) => {
      const entry = (panel.providers || []).find((row) => row.value === option.value);
      return { ...option, source: entry ? entry.source : "models.dev" };
    }),
  };
  const modelSelect = el("model");
  const byProvider = {};
  for (const option of provider.options) {
    providerSelect.value = option.value;
    providerSelect.fire("change");
    byProvider[option.value] = optionsOf(modelSelect);
  }
  providerSelect.value = provider.current;
  providerSelect.fire("change");
  const model = {
    control: controlOf("model", html),
    selectedProvider: providerSelect.value,
    selectedModel: modelSelect.value,
    byProvider,
  };

  // R3 — endpoint autofill on a provider change, then a user override surviving a switch.
  const endpointInput = el("endpoint");
  const startProvider = provider.options[0];
  const nextProvider = provider.options.find((option) => {
    const entry = (panel.providers || []).find((candidate) => candidate.value === option.value);
    return entry && entry.api && option.value !== startProvider.value;
  }) || provider.options[1];
  const apiOf = (id) => (panel.providers || []).find((entry) => entry.value === id)?.api || "";

  providerSelect.value = startProvider.value;
  providerSelect.fire("change");
  const before = endpointInput.value;
  providerSelect.value = nextProvider.value;
  providerSelect.fire("change");
  const after = endpointInput.value;

  endpointInput.value = "https://proxy.example/v1";
  endpointInput.fire("input");
  const userEdited = endpointInput.value;
  providerSelect.value = startProvider.value;
  providerSelect.fire("change");
  const afterSwitch = endpointInput.value;
  const endpoint = {
    control: controlOf("endpoint", html),
    autofill: {
      provider: nextProvider.value,
      providerApi: apiOf(nextProvider.value),
      before,
      after,
      userEdited,
      afterSwitch,
    },
  };

  // R4 — reasoning picker: the sentinel default, plus resolution across model capabilities.
  const reasoning = {
    control: controlOf("reasoning", html),
    default: el("reasoning").value,
    options: optionsOf(el("reasoning")),
    resolved: reasoningCases(g.DualTranCore.resolveReasoningDepth, el("reasoning").options.map((o) => o.value)),
  };

  // R5 — the locale matrix, read from the shipped I18N.gs.
  const i18nModule = g.DUALTRAN_I18N || {};
  const ui = panel.ui || {};
  const usedKeys = [...new Set([...html.matchAll(/\bt\("([^"]+)"\)/g)].map((match) => match[1]))];
  const i18n = {
    locales: Object.keys(i18nModule),
    keys: Object.keys(i18nModule.en || {}),
    sourceLocale: "en",
    files: i18nModule,
    used: usedKeys,
    panelKeys: Object.keys(ui),
    locale: panel.locale,
  };

  return {
    spec: SPEC_VERSION,
    host: HOST,
    language,
    provider,
    model,
    endpoint,
    reasoning,
    i18n,
  };
}

export default buildPayload;
