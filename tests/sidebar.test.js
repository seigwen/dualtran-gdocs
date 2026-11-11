import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPanelDom, loadSidebar } from "../scripts/conformance/payload.mjs";

const html = readFileSync(new URL("../Sidebar.html", import.meta.url), "utf8");

/** Every id the page script touches. */
const IDS = ["engine", "target", "provider", "model", "reasoning", "endpoint", "apiKey", "run", "status", "ai-fields", "endpoint-hint", "panel-title"];

/** What Code.gs getPanelData() hands the sidebar, shaped like the real thing. */
function panelFixture(overrides = {}) {
  return {
    settings: {
      engine: "ai",
      target: "zh-CN",
      provider: "openai",
      model: "gpt-5.6",
      reasoning: "lowest",
      endpoint: "https://api.openai.com/v1",
      apiKey: "",
    },
    locale: "en",
    ui: {
      title: "DualTran Translate",
      target: "Target language",
      provider: "Provider",
      model: "Model",
      endpoint: "API base URL",
      reasoning: "Reasoning effort",
      apiKey: "API key",
      engine: "Engine",
      engineGoogle: "Google Translate (no key)",
      engineAi: "AI endpoint (your key)",
      translate: "Translate selection",
      endpointHint: "Must start with http:// or https://",
      statusTranslating: "Translating...",
      statusTranslated: "Translated {COUNT} paragraph(s).",
      statusCatalogOffline: "Model list unavailable - type a model name.",
    },
    languages: [
      { value: "en", label: "English (en)" },
      { value: "zh-CN", label: "Chinese (Simplified) (zh-CN)" },
    ],
    providers: [
      { value: "anthropic", label: "Anthropic", source: "models.dev", api: "https://api.anthropic.com/v1" },
      { value: "openai", label: "OpenAI", source: "built-in", api: "https://api.openai.com/v1" },
    ],
    modelsByProvider: {
      anthropic: [{ value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" }],
      openai: [
        { value: "gpt-4o", label: "GPT-4o" },
        { value: "gpt-5.6", label: "GPT-5.6" },
      ],
    },
    reasoningByProvider: {
      anthropic: { "claude-sonnet-4-5": ["none"] },
      openai: { "gpt-5.6": ["none", "low", "medium", "high"] },
    },
    ...overrides,
  };
}

function mount(panel) {
  const dom = createPanelDom(IDS);
  const sidebar = loadSidebar({ document: dom.document, t: (key) => key });
  sidebar.renderPanel(panel);
  const el = (id) => dom.elements.get(id);
  return { dom, sidebar, el };
}

describe("Sidebar.html structure", () => {
  it("has a target-language <select> and no target text input (R1)", () => {
    expect(html).toMatch(/<select[^>]*id="target"/);
    expect(html).not.toMatch(/<input[^>]*id="target"/);
  });

  it("has provider, model and reasoning <select>s (R2, R4)", () => {
    for (const id of ["provider", "model", "reasoning"]) {
      expect(html, id).toMatch(new RegExp(`<select[^>]*id="${id}"`));
      expect(html, id).not.toMatch(new RegExp(`<input[^>]*id="${id}"`));
    }
  });

  it("keeps the endpoint as an editable text input (R3)", () => {
    expect(html).toMatch(/<input[^>]*id="endpoint"/);
    expect(html).not.toMatch(/<select[^>]*id="endpoint"/);
    expect(html).toMatch(/id="apiKey"[^>]*type="password"|type="password"[^>]*id="apiKey"/);
  });

  it("carries no divider or 'more' row (R2)", () => {
    expect(html).not.toMatch(/providerSeparator|__separator__|__more__|More \(models\.dev\)/);
  });

  it("loads panel data, not the bare settings object", () => {
    expect(html).toMatch(/\.getPanelData\(\)/);
    expect(html).not.toMatch(/\.getSettings\(\)/);
  });

  it("exposes renderPanel/collect for the conformance harness", () => {
    expect(html).toMatch(/function renderPanel\(/);
    expect(html).toMatch(/function collect\(/);
  });

  it("labels the endpoint hint through i18n (R5)", () => {
    expect(html).toMatch(/id="endpoint-hint"[^>]*data-i18n="endpointHint"/);
  });
});

describe("Sidebar rendering (real page script)", () => {
  it("renders the language select with readable labels and selects the stored target", () => {
    const { el } = mount(panelFixture());
    const target = el("target");
    expect(target.options.length).toBe(2);
    expect(target.value).toBe("zh-CN");
    expect(target.options.map((option) => option.label)).toContain("Chinese (Simplified) (zh-CN)");
  });

  it("renders one provider list and the models of the selected provider", () => {
    const { el } = mount(panelFixture());
    expect(el("provider").options.map((option) => option.value)).toEqual(["anthropic", "openai"]);
    expect(el("provider").value).toBe("openai");
    expect(el("model").options.map((option) => option.value)).toEqual(["gpt-4o", "gpt-5.6"]);
    expect(el("model").value).toBe("gpt-5.6");
  });

  it("offers the lowest sentinel first, then the model's own levels (R4)", () => {
    const { el } = mount(panelFixture());
    const reasoning = el("reasoning");
    expect(reasoning.options[0].value).toBe("lowest");
    expect(reasoning.options.map((option) => option.value)).toEqual(["lowest", "none", "low", "medium", "high"]);
    expect(reasoning.value).toBe("lowest");
  });

  it("hides the AI fields for the no-key engine and shows them for the AI engine", () => {
    expect(mount(panelFixture()).el("ai-fields").hidden).toBe(false);
    const google = panelFixture();
    google.settings.engine = "google";
    expect(mount(google).el("ai-fields").hidden).toBe(true);
    const { el } = mount(panelFixture());
    el("engine").value = "google";
    el("engine").fire("change");
    expect(el("ai-fields").hidden).toBe(true);
  });

  it("applies the translations from ui to the labels", () => {
    const dom = createPanelDom(IDS);
    const t = (locale, key) => (locale === "zh_TW" ? { title: "DualTran 翻譯", translate: "翻譯選取內容" }[key] : key);
    const sidebar = loadSidebar({ document: dom.document, t });
    const panel = panelFixture();
    panel.settings = { ...panel.settings, target: "zh-TW" };
    panel.ui.title = t("zh_TW", "title");
    panel.ui.translate = t("zh_TW", "translate");
    sidebar.renderPanel(panel);
    expect(dom.elements.get("panel-title").labelText).toBe("DualTran 翻譯");
    expect(dom.elements.get("run").labelText).toBe("翻譯選取內容");
  });
});

describe("provider change behaviour (R3)", () => {
  it("fills the endpoint with the new provider's API base", () => {
    const { el } = mount(panelFixture());
    expect(el("endpoint").value).toBe("https://api.openai.com/v1");
    el("provider").value = "anthropic";
    el("provider").fire("change");
    expect(el("endpoint").value).toBe("https://api.anthropic.com/v1");
  });

  it("repopulates the model list and the reasoning levels on the same change", () => {
    const { el } = mount(panelFixture());
    el("provider").value = "anthropic";
    el("provider").fire("change");
    expect(el("model").options.map((option) => option.value)).toEqual(["claude-sonnet-4-5"]);
    expect(el("reasoning").options.map((option) => option.value)).toEqual(["lowest", "none"]);
  });

  it("keeps a user-typed endpoint across provider switches", () => {
    const { el } = mount(panelFixture());
    const endpoint = el("endpoint");
    endpoint.value = "https://proxy.example/v1";
    endpoint.fire("input");
    el("provider").value = "anthropic";
    el("provider").fire("change");
    expect(endpoint.value).toBe("https://proxy.example/v1");
  });

  it("leaves the endpoint alone when the provider has no API base", () => {
    const panel = panelFixture();
    panel.providers.push({ value: "mystery", label: "Mystery", source: "models.dev", api: "" });
    panel.modelsByProvider.mystery = [{ value: "m1", label: "M1" }];
    const { el } = mount(panel);
    el("provider").value = "mystery";
    el("provider").fire("change");
    expect(el("endpoint").value).toBe("https://api.openai.com/v1");
  });

  it("falls back to the offline hint when a provider has no models", () => {
    const panel = panelFixture();
    panel.modelsByProvider.openai = [];
    const { el } = mount(panel);
    expect(el("model").options).toHaveLength(1);
    expect(el("model").options[0].label).toBe("Model list unavailable - type a model name.");
  });
});

describe("submit (R3, R4, R5)", () => {
  it("passes the full settings, not just target/model", () => {
    const { el, sidebar } = mount(panelFixture());
    el("provider").value = "anthropic";
    el("provider").fire("change");
    el("model").value = "claude-sonnet-4-5";
    el("model").fire("change");
    const patch = sidebar.collect();
    expect(Object.keys(patch).sort()).toEqual(["apiKey", "endpoint", "engine", "model", "provider", "reasoning", "target"]);
    expect(patch.provider).toBe("anthropic");
    expect(patch.endpoint).toBe("https://api.anthropic.com/v1");
    expect(patch.reasoning).toBe("lowest");
    expect(patch.target).toBe("zh-CN");
  });

  it("submits through saveAndTranslate", () => {
    expect(html).toMatch(/\.saveAndTranslate\(collect\(\)\)/);
  });
});
