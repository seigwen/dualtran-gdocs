import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createStorage, loadAddon } from "../scripts/conformance/gs-shim.mjs";

const catalog = JSON.parse(readFileSync(new URL("../tests/fixtures/conformance/models-dev-sample.json", import.meta.url), "utf8"));

function boot(options = {}) {
  const storage = createStorage();
  const addon = loadAddon({
    storage,
    locale: options.locale ?? "en",
    fetchImpl: options.fetchImpl,
  });
  return { ...addon, storage, g: addon.sandbox };
}

describe("getCatalog", () => {
  it("fetches models.dev once, projects it, and caches for the next 24h", () => {
    const { g, fetches, storage } = boot({
      fetchImpl: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(catalog) }),
    });
    const first = g.getCatalog();
    expect(fetches.map((call) => call.url)).toEqual(["https://models.dev/api.json"]);
    expect(first.providers.length).toBeGreaterThan(10);
    expect(Object.keys(first)).toEqual(["providers", "modelsById", "reasoning"]);
    expect(storage.cache.get("catalog:v1")).toBeTruthy();

    const second = g.getCatalog();
    expect(fetches.length).toBe(1);
    expect(second.providers.length).toBe(first.providers.length);
  });

  it("falls back to built-ins with no models when the network fails", () => {
    const { g } = boot({
      fetchImpl: () => {
        throw new Error("offline");
      },
    });
    const catalogEmpty = g.getCatalog();
    expect(catalogEmpty.providers).toEqual([]);
    const panel = g.getPanelData();
    expect(panel.providers.length).toBeGreaterThanOrEqual(5);
    expect(panel.providers.every((row) => row.source === "built-in")).toBe(true);
    expect(panel.models).toEqual([]);
  });

  it("does not pin the offline fallback in the cache", () => {
    let online = false;
    const { g, fetches } = boot({
      fetchImpl: () => {
        if (!online) throw new Error("offline");
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(catalog) };
      },
    });
    expect(g.getCatalog().providers).toEqual([]);
    online = true;
    expect(g.getCatalog().providers.length).toBeGreaterThan(10);
    expect(fetches.length).toBe(2);
  });

  it("ignores a non-200 answer and a corrupt cache entry", () => {
    const { g, storage } = boot({ fetchImpl: () => ({ getResponseCode: () => 429, getContentText: () => "{}" }) });
    expect(g.getCatalog().providers).toEqual([]);
    storage.cacheService.put("catalog:v1", "{not json");
    expect(() => g.getCatalog()).not.toThrow();
  });
});

describe("getPanelData", () => {
  const fetchOk = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(catalog) });

  it("returns the shape the sidebar renders", () => {
    const { g } = boot({ fetchImpl: fetchOk });
    const panel = g.getPanelData();
    for (const key of ["settings", "ui", "languages", "providers", "modelsByProvider", "reasoning"]) {
      expect(panel, key).toHaveProperty(key);
    }
    expect(panel.ui.title).toBe("DualTran Translate");
    expect(panel.languages.length).toBeGreaterThanOrEqual(30);
    expect(panel.modelsByProvider[panel.settings.provider].length).toBeGreaterThan(0);
    expect(panel.reasoning[0].value).toBe("lowest");
  });

  it("picks the locale from Session.getActiveUserLocale", () => {
    const zh = boot({ fetchImpl: fetchOk, locale: "zh-TW" });
    expect(zh.g.getPanelData().ui.provider).toBe("服務供應商");
    const ko = boot({ fetchImpl: fetchOk, locale: "ko" });
    expect(ko.g.getPanelData().locale).toBe("ko");
    const unknown = boot({ fetchImpl: fetchOk, locale: "am" });
    expect(unknown.g.getPanelData().locale).toBe("en");
  });

  it("ships every UI string as a non-empty translated value", () => {
    const { g } = boot({ fetchImpl: fetchOk, locale: "zh_CN" });
    const ui = g.getPanelData().ui;
    expect(Object.keys(ui).length).toBeGreaterThanOrEqual(16);
    for (const [key, value] of Object.entries(ui)) {
      expect(typeof value, key).toBe("string");
      expect(value.trim(), key).not.toBe("");
    }
  });
});

describe("saveAndTranslate / saveSettings", () => {
  const fetchOk = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(catalog) });

  it("persists every setting the sidebar submits", () => {
    const { g } = boot({ fetchImpl: fetchOk });
    g.saveSettings({
      target: "ja",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      endpoint: "https://proxy.example/v1",
      reasoning: "low",
      apiKey: "sk-test",
    });
    const settings = g.getSettings();
    expect(settings).toMatchObject({
      target: "ja",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      endpoint: "https://proxy.example/v1",
      reasoning: "low",
      apiKey: "sk-test",
    });
  });

  it("refuses unknown keys and clears a field set to empty", () => {
    const { g } = boot({ fetchImpl: fetchOk });
    g.saveSettings({ apiKey: "sk-test", nonsense: "x", __proto__: "y" });
    expect(g.getSettings()).not.toHaveProperty("nonsense");
    g.saveSettings({ apiKey: "" });
    expect(g.getSettings().apiKey).toBe("");
  });

  it("drops the stale model when the provider changes without one", () => {
    const { g } = boot({ fetchImpl: fetchOk });
    g.saveSettings({ provider: "openai", model: "gpt-5.6" });
    g.saveSettings({ provider: "deepseek" });
    expect(g.getSettings().provider).toBe("deepseek");
    expect(g.getSettings().model).not.toBe("gpt-5.6");
    // Naming a model still wins.
    g.saveSettings({ provider: "deepseek", model: "deepseek-v4-pro" });
    expect(g.getSettings().model).toBe("deepseek-v4-pro");
  });

  it("returns a translated failure when nothing is selected", () => {
    const { g } = boot({ fetchImpl: fetchOk, locale: "zh_TW" });
    const result = g.saveAndTranslate({ target: "ja" });
    expect(result.ok).toBe(false);
    expect(result.message).toBe(g.DUALTRAN_I18N.zh_TW.statusNoSelection);
  });
});

describe("reasoning sent to the provider", () => {
  it("resolves the lowest sentinel against the chosen model's declared levels", () => {
    const { g } = boot({ fetchImpl: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(catalog) }) });
    g.saveSettings({ provider: "openai", model: "gpt-5.6", reasoning: "lowest" });
    const levels = g.DualTranCore.reasoningForProvider(g.getCatalog(), "openai", "gpt-5.6");
    expect(g.DualTranCore.resolveReasoningDepth("lowest", levels)).toBe("none");
    expect(g.resolveRequestedReasoning(g.getSettings())).toBe("none");
  });

  it("still resolves for a model the catalogue does not know", () => {
    const { g } = boot({ fetchImpl: () => ({ getResponseCode: () => 503, getContentText: () => "" }) });
    g.saveSettings({ provider: "openai", model: "my-private-model", reasoning: "lowest" });
    expect(g.resolveRequestedReasoning(g.getSettings())).toBe("none");
  });
});
