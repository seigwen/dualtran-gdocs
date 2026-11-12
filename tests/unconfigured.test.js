import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPanelDom, loadSidebar } from "../scripts/conformance/payload.mjs";
import { createStorage, loadAddon } from "../scripts/conformance/gs-shim.mjs";

/**
 * SPEC 2.1 — the unconfigured AI provider.
 *
 * A fresh install has no AI provider: `""`. These tests pin the empty state, the disabled
 * placeholder, the guard that refuses to translate without a provider, and the absence of a
 * silent OpenAI fallback anywhere on a request path.
 */
const catalog = JSON.parse(readFileSync(new URL("../tests/fixtures/conformance/models-dev-sample.json", import.meta.url), "utf8"));
const code = readFileSync(new URL("../Code.gs", import.meta.url), "utf8");
const core = readFileSync(new URL("../Core.gs", import.meta.url), "utf8");
const sidebarHtml = readFileSync(new URL("../Sidebar.html", import.meta.url), "utf8");

const fetchOk = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(catalog) });

function boot(options = {}) {
  const storage = createStorage();
  const addon = loadAddon({ storage, locale: options.locale ?? "en", fetchImpl: options.fetchImpl ?? fetchOk });
  return { ...addon, storage, g: addon.sandbox, fetches: addon.fetches };
}

const IDS = ["engine", "target", "provider", "model", "reasoning", "endpoint", "apiKey", "run", "status", "ai-fields", "panel-title"];

describe("fresh install (SPEC 2.1)", () => {
  it("defaults the provider to the empty string and stores an unset value as empty", () => {
    expect(code).toMatch(/provider:\s*""/);
    const { g } = boot();
    expect(g.DEFAULTS.provider).toBe("");
    expect(g.getSettings().provider).toBe("");
  });

  it("does not ship an OpenAI endpoint or model as the default", () => {
    const { g } = boot();
    const settings = g.getSettings();
    expect(settings.endpoint).toBe("");
    expect(settings.model).toBe("");
    expect(JSON.stringify(settings)).not.toContain("api.openai.com");
    expect(JSON.stringify(settings)).not.toContain("gpt-");
  });

  it("keeps the reasoning sentinel at lowest while unconfigured", () => {
    const { g } = boot();
    expect(g.getSettings().reasoning).toBe("lowest");
  });

  it("never rewrites a stored provider", () => {
    const { g } = boot();
    g.saveSettings({ provider: "anthropic", endpoint: "https://api.anthropic.com/v1" });
    expect(g.getSettings().provider).toBe("anthropic");
    g.saveSettings({ target: "ja" });
    expect(g.getSettings().provider).toBe("anthropic");
    expect(g.getSettings().endpoint).toBe("https://api.anthropic.com/v1");
  });
});

describe("provider picker empty state (SPEC 2.1 / R2)", () => {
  function render(settings) {
    const { g } = boot();
    g.saveSettings(settings);
    const panel = g.getPanelData();
    const dom = createPanelDom(IDS);
    const sidebar = loadSidebar({ document: dom.document, t: panel.ui });
    sidebar.renderPanel(panel);
    return { panel, el: (id) => dom.elements.get(id) };
  }

  it("renders the disabled placeholder first, selected, outside the real options", () => {
    const { el } = render({});
    const provider = el("provider");
    const placeholder = provider.options[0];
    expect(placeholder).toMatchObject({ value: "", label: "Select a provider", disabled: true });
    expect(provider.value).toBe("");
    expect(provider.options.filter((option) => option.value === "").length).toBe(1);
    // Real providers stay one alphabetical (label-sorted) list; the placeholder is not sorted in.
    const real = provider.options.slice(1);
    expect(real.map((option) => option.value)).not.toContain("");
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    for (let i = 1; i < real.length; i += 1) {
      expect(collator.compare(real[i - 1].label, real[i].label)).toBeLessThanOrEqual(0);
    }
    expect(real.length).toBeGreaterThan(5);
  });

  it("localizes the placeholder (zh_CN)", () => {
    const { g } = boot({ locale: "zh-CN" });
    const panel = g.getPanelData();
    const dom = createPanelDom(IDS);
    loadSidebar({ document: dom.document, t: panel.ui }).renderPanel(panel);
    expect(dom.elements.get("provider").options[0].label).toBe("请选择 AI 提供商");
  });

  it("leaves the endpoint empty with the https:// placeholder", () => {
    const { el } = render({});
    expect(el("endpoint").value).toBe("");
    expect(el("endpoint").placeholder).toBe("https://");
  });

  it("disables the model picker with the 'select a provider first' label", () => {
    const { el } = render({});
    const model = el("model");
    expect(model.disabled).toBe(true);
    expect(model.options.length).toBe(0);
    expect(model.getAttribute("placeholder")).toBe("Select a provider first");
  });

  it("disables the reasoning picker but keeps the lowest sentinel stored", () => {
    const { el, panel } = render({});
    expect(el("reasoning").disabled).toBe(true);
    expect(el("reasoning").value).toBe("lowest");
    expect(panel.settings.reasoning).toBe("lowest");
  });

  it("enables model + reasoning and fills the endpoint once a provider is chosen", () => {
    const { el } = render({});
    el("provider").value = "anthropic";
    el("provider").fire("change");
    expect(el("endpoint").value).toBe("https://api.anthropic.com/v1");
    expect(el("model").disabled).toBe(false);
    expect(el("model").options.length).toBeGreaterThan(0);
    expect(el("reasoning").disabled).toBe(false);
  });

  it("cannot go back to the empty provider once chosen", () => {
    const { el } = render({ provider: "deepseek", endpoint: "https://api.deepseek.com/v1" });
    const provider = el("provider");
    expect(provider.value).toBe("deepseek");
    expect(provider.options[0].disabled).toBe(true);
    expect(provider.options.some((option) => /^none$/i.test(option.label))).toBe(false);
  });
});

describe("no provider, no request (SPEC 2.1 / R6 guard)", () => {
  it("returns the localized providerRequiredError and sends nothing", () => {
    const { g, fetches } = boot({ locale: "zh_CN" });
    g.saveSettings({ engine: "ai" });
    const result = g.translateSelectionFromUi();
    expect(result.ok).toBe(false);
    expect(result.translated).toBe(0);
    expect(result.message).toBe(g.DUALTRAN_I18N.zh_CN.providerRequiredError);
    // Only the models.dev catalogue fetch may run; no translation request is ever sent.
    expect(fetches.some((call) => call.url !== "https://models.dev/api.json")).toBe(false);
  });

  it("never calls UrlFetchApp for a translation when the provider is empty", () => {
    const { g, fetches } = boot();
    g.saveSettings({ engine: "ai", model: "gpt-5.6", endpoint: "https://api.openai.com/v1", apiKey: "sk-test" });
    // A stale endpoint/model must not slip through when the provider itself is empty.
    g.saveSettings({ provider: "" });
    const before = fetches.length;
    let error = null;
    try {
      g.translateText("Hello", { engine: "ai", target: "zh-CN", provider: "", endpoint: "https://api.openai.com/v1", model: "gpt-5.6" });
    } catch (caught) {
      error = caught;
    }
    expect(error && error.message).toBe(g.DUALTRAN_I18N.en.providerRequiredError);
    expect(fetches.length - before).toBe(0);
  });

  it("has no || \"openai\" / || CUSTOM_PROVIDER fallback on the request path", () => {
    for (const source of [code, core]) {
      expect(source).not.toMatch(/\|\|\s*["']openai["']/);
      expect(source).not.toMatch(/\|\|\s*CUSTOM_PROVIDER/);
    }
  });
});

describe("Sidebar guard (SPEC 2.1)", () => {
  it("declares a disabled primary button whose title is the providerRequiredError", () => {
    expect(sidebarHtml).toMatch(/t\("providerRequiredError"\)/);
    expect(sidebarHtml).toMatch(/button\.disabled\s*=\s*required/);
    expect(sidebarHtml).toMatch(/setAttribute\("title",\s*required\s*\?\s*t\("providerRequiredError"\)/);
  });

  it("disables the button and titles it from the real render when no provider is set", () => {
    const dom = createPanelDom(IDS);
    const sidebar = loadSidebar({ document: dom.document, t: (key) => key });
    sidebar.renderPanel({
      settings: { engine: "ai", target: "zh-CN", provider: "", endpoint: "", model: "", reasoning: "lowest" },
      ui: { translate: "Translate selection", providerPlaceholder: "Select a provider", providerRequiredForModel: "Select a provider first", providerRequiredError: "Choose an AI provider in settings before translating." },
      languages: [{ value: "zh-CN", label: "Chinese (Simplified) (zh-CN)" }],
      providers: [{ value: "openai", label: "OpenAI", source: "built-in", api: "https://api.openai.com/v1" }],
      modelsByProvider: { openai: [{ value: "gpt-4o", label: "GPT-4o" }] },
      reasoningByProvider: {},
    });
    const run = dom.elements.get("run");
    expect(run.disabled).toBe(true);
    expect(run.getAttribute("title")).toBe("Choose an AI provider in settings before translating.");
    expect(dom.elements.get("status").textContent).toBe("Choose an AI provider in settings before translating.");
  });

  it("does not fall back to the first provider when none is selected", () => {
    expect(sidebarHtml).not.toMatch(/selectedIndex\s*=\s*0/);
    expect(sidebarHtml).not.toMatch(/provider[^;]*\|\|\s*"openai"/);
  });
});
