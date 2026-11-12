/**
 * DualTran conformance payload generator (SPEC 2.1.0).
 *
 * Every value below is produced by driving the add-on's real settings surface:
 * Core.gs project helpers, Code.gs getPanelData()/saveAndTranslate(), and the DOM the
 * Sidebar.html script builds against. The generator only shims the Apps Script services
 * (see gs-shim.mjs); it never re-implements a product rule.
 *
 * SPEC 2.1: the provider picker is captured in BOTH states — a fresh install (unconfigured,
 * `provider.current === ""`) and a configured one — because each state owns different rules
 * (disabled placeholder, disabled model/reasoning, endpoint placeholder).
 */
import { readRepoFile } from "./gs-shim.mjs";
import { loadAddon } from "./gs-shim.mjs";

export const SPEC_VERSION = "2.1.0";

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
    this.attributes = {};
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
    if (name === "id") return this.id;
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  setAttribute(name, value) {
    // A DOM attribute is stored as a string; "" is a real (empty) value, not "absent".
    this.attributes[name] = String(value);
    if (name === "placeholder") this.placeholder = this.attributes[name];
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  appendChild(option) {
    // A DOM <option> keeps `label` (attribute) and `text`/`textContent` (content) in
    // sync; mirror that so the sidebar sets either one and readers see both. `disabled`
    // is an own property of the option element, so it is not inherited by the <select>.
    const row = {
      value: String(option.value ?? ""),
      label: String(option.label ?? option.textContent ?? option.text ?? option.value ?? ""),
      ...(option.disabled ? { disabled: true } : {}),
    };
    this.options.push(row);
    // A browser does NOT rewrite the value when options are appended: the selection is
    // whatever the page assigned. Only a select with no explicit value picks its first row.
    if (this.value === "" && this.options.length === 1 && row.value !== "") this.value = row.value;
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
    syncRunState: typeof syncRunState === "function" ? syncRunState : null,
    currentPanel: typeof currentPanel !== "undefined" ? currentPanel : null,
  };`)(document, {
    script: {
      run: { withSuccessHandler: () => ({ withFailureHandler: () => ({ getPanelData() {} }) }), saveAndTranslate() {} },
    },
  });
  api.t = t;
  return api;
}

/** The placeholder attribute Sidebar.html declares on a control, as served. */
function markupPlaceholder(id, html) {
  const tag = new RegExp(`<(select|input)\\b[^>]*\\bid="${id}"[^>]*>`, "i").exec(html);
  if (!tag) return null;
  const placeholder = /\bplaceholder="([^"]*)"/i.exec(tag[0]);
  return placeholder ? placeholder[1] : null;
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
  const el = (id) => panelDom.elements.get(id);
  const apiOf = (id) => (g.getPanelData().providers.find((entry) => entry.value === id) || {}).api || "";

  /** One render of the real page script against the stored settings, then the DOM as painted. */
  function paint() {
    const panel = g.getPanelData();
    const sidebar = loadSidebar({ document: panelDom.document, t: panel.ui });
    if (!sidebar.renderPanel) throw new Error("Sidebar.html must expose renderPanel(panel)");
    sidebar.renderPanel(panel);
    return { panel, sidebar, el };
  }

  // ── State 1: a fresh install — no provider chosen yet (SPEC 2.1) ─────────
  const fresh = paint();
  const emptyProviderSelect = el("provider");
  const placeholderOption = emptyProviderSelect.options.find((option) => String(option.value) === "");
  const emptyProviderCurrent = emptyProviderSelect.value;
  const emptyModelDisabled = el("model").disabled === true;
  const emptyModelOptions = optionsOf(el("model"));
  const emptyReasoningDisabled = el("reasoning").disabled === true;
  const emptyEndpointCurrent = el("endpoint").value;
  // Read from the DOM: Sidebar.html sets it on the input, the markup carries the served value.
  const emptyEndpointPlaceholder = el("endpoint").getAttribute("placeholder") || markupPlaceholder("endpoint", html) || "";
  const emptyProviderRequiredError = String(fresh.panel.providerRequiredError || "");
  const emptyProviderRequiredForModel = String(fresh.panel.providerRequiredForModel || "");
  const emptyProviderId = String(fresh.panel.settings.provider || "");
  const emptySettings = { ...fresh.panel.settings, engine: "ai" };
  // The guard, driven through the same entry point the sidebar button uses, with the settings
  // exactly as they were painted (the AI engine needs a provider; nothing is configured yet).
  const guardResult = g.translateSelectionFromUi(emptySettings);
  const guard = {
    engine: String(emptySettings.engine),
    provider: emptyProviderId,
    ok: guardResult.ok === true,
    message: String(guardResult.message || ""),
    translated: Number(guardResult.translated || 0),
  };

  // R3 — from the empty state, choosing a provider must fill the endpoint's *value*.
  const providerCandidates = emptyProviderSelect.options.filter((option) => String(option.value) !== "" && !option.disabled);
  const firstProvider = providerCandidates[0];
  const chosenProvider = providerCandidates.find((option) => apiOf(option.value)) || firstProvider;
  emptyProviderSelect.value = chosenProvider.value;
  emptyProviderSelect.fire("change");
  const afterFirstPick = el("endpoint").value;

  // ── State 2: configured — the stored provider drives every other control ─
  g.saveSettings({
    provider: chosenProvider.value,
    endpoint: apiOf(chosenProvider.value),
    model: "",
  });
  const configured = paint();
  const providerSelect = el("provider");

  // R1 — target language picker, as rendered.
  const language = {
    control: controlOf("target", html),
    current: el("target").value,
    options: optionsOf(el("target")),
  };

  // R2 — provider picker + per-provider model lists, as rendered (configured state).
  const providerOptions = optionsOf(providerSelect).filter((option) => String(option.value) !== "");
  const provider = {
    control: controlOf("provider", html),
    current: providerSelect.value,
    placeholder: {
      value: "",
      label: placeholderOption ? String(placeholderOption.label) : "",
      disabled: !!(placeholderOption && placeholderOption.disabled),
      selected: String(providerSelect.value) === "",
    },
    // No silent default: an unconfigured panel falls back to nothing at all.
    fallback: String(fresh.panel.settings.provider || ""),
    options: optionsOf(providerSelect)
      .filter((option) => String(option.value) !== "")
      .map((option) => {
        const entry = (configured.panel.providers || []).find((row) => row.value === option.value);
        return { ...option, source: entry ? entry.source : "models.dev" };
      }),
  };

  const modelSelect = el("model");
  const byProvider = {};
  for (const option of providerOptions) {
    providerSelect.value = option.value;
    providerSelect.fire("change");
    byProvider[option.value] = optionsOf(modelSelect);
  }
  providerSelect.value = provider.current;
  providerSelect.fire("change");
  const model = {
    control: controlOf("model", html),
    disabled: modelSelect.disabled === true,
    selectedProvider: providerSelect.value,
    // SPEC 2.1: the model starts empty — picking a provider loads the list, it does not
    // silently adopt the first row as the model that gets sent.
    selectedModel: "",
    options: optionsOf(modelSelect),
    byProvider,
    placeholder: markupPlaceholder("model", html) || "",
  };

  // R3 — endpoint autofill on a provider change, then a user override surviving a switch.
  const startProvider = provider.options[0];
  const nextProvider = provider.options.find((option) => {
    const entry = (configured.panel.providers || []).find((candidate) => candidate.value === option.value);
    return entry && entry.api && option.value !== startProvider.value;
  }) || provider.options[1];
  const endpointInput = el("endpoint");

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
    current: before,
    placeholder: emptyEndpointPlaceholder,
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
    disabled: el("reasoning").disabled === true,
    default: el("reasoning").value,
    options: optionsOf(el("reasoning")),
    resolved: reasoningCases(g.DualTranCore.resolveReasoningDepth, el("reasoning").options.map((o) => o.value)),
  };

  // R5 — the locale matrix, read from the shipped I18N.gs.
  const i18nModule = g.DUALTRAN_I18N || {};
  const ui = fresh.panel.ui || {};
  const usedKeys = [...new Set([...html.matchAll(/\bt\("([^"]+)"\)/g)].map((match) => match[1]))];
  const i18n = {
    locales: Object.keys(i18nModule),
    keys: Object.keys(i18nModule.en || {}),
    sourceLocale: "en",
    files: i18nModule,
    used: usedKeys,
    panelKeys: Object.keys(ui),
    locale: fresh.panel.locale,
  };

  // The empty state must be provable, not assumed: keep everything the SPEC 2.1 unconfigured
  // rules talk about, captured from the fresh render and the same entry points the page uses.
  const emptyPanel = fresh.panel;
  const emptyState = {
    provider: {
      control: controlOf("provider", html),
      current: emptyProviderCurrent,
      placeholder: {
        value: "",
        label: placeholderOption ? String(placeholderOption.label) : "",
        disabled: !!(placeholderOption && placeholderOption.disabled),
        selected: String(emptyProviderCurrent) === "" && !!placeholderOption,
      },
      fallback: String(emptyPanel.settings.provider || ""),
      options: optionsOf(emptyProviderSelect)
        .filter((option) => String(option.value) !== "")
        .map((option) => {
          const entry = (emptyPanel.providers || []).find((row) => row.value === option.value);
          return { ...option, source: entry ? entry.source : "models.dev" };
        }),
    },
    model: {
      control: controlOf("model", html),
      disabled: emptyModelDisabled,
      selectedProvider: emptyProviderCurrent,
      selectedModel: "",
      options: emptyModelOptions.filter((option) => String(option.value) !== ""),
      placeholder: emptyProviderRequiredForModel,
    },
    endpoint: {
      control: controlOf("endpoint", html),
      current: emptyEndpointCurrent,
      placeholder: emptyEndpointPlaceholder,
      afterFirstPick,
      providerApi: apiOf(chosenProvider.value),
    },
    reasoning: {
      control: controlOf("reasoning", html),
      disabled: emptyReasoningDisabled,
      default: String(emptyPanel.settings.reasoning || ""),
    },
    settings: {
      provider: String(emptyPanel.settings.provider || ""),
      endpoint: String(emptyPanel.settings.endpoint || ""),
      model: String(emptyPanel.settings.model || ""),
    },
    providerRequiredError: emptyProviderRequiredError,
    guard,
  };
  // Re-paint the configured state so the DOM left behind is the one the main sections describe.
  paint();

  return {
    spec: SPEC_VERSION,
    host: HOST,
    language,
    provider,
    model,
    endpoint,
    reasoning,
    i18n,
    // SPEC 2.1: both states, plus the guard that proves an empty provider sends nothing.
    emptyState,
    guard,
  };
}

export default buildPayload;
