import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import core from "../Core.gs";

describe("endpoint handling", () => {
  it("rejects a schemeless endpoint", () => {
    expect(() => core.normalizeEndpoint("api.openai.com/v1")).toThrow(/must start with http/);
  });

  it("completes the chat path", () => {
    expect(core.chatCompletionsUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(core.chatCompletionsUrl("https://api.deepseek.com")).toBe(
      "https://api.deepseek.com/v1/chat/completions"
    );
  });
});

describe("AI payloads", () => {
  it("names the target language and keeps the text verbatim", () => {
    const payload = core.buildChatPayload("gpt-4o-mini", "Hello world", "zh-CN");
    expect(payload.messages[0].content).toContain("zh-CN");
    expect(payload.messages[1].content).toBe("Hello world");
    expect(payload.temperature).toBe(0);
  });

  it("surfaces provider errors and refuses empty answers", () => {
    expect(() => core.parseChatResponse({ error: { message: "bad key" } })).toThrow("bad key");
    expect(() => core.parseChatResponse({ choices: [{ message: { content: " " } }] })).toThrow(/empty/);
  });
});

describe("Google Translate", () => {
  it("encodes the query", () => {
    const url = core.googleUrl("a & b", "zh-CN");
    expect(url).toContain("q=a%20%26%20b");
    expect(url).toContain("tl=zh-CN");
  });

  it("joins sentence pieces", () => {
    expect(core.parseGoogleResponse([[["你好", "Hello"], ["世界", " world"]], null, "en"])).toBe("你好世界");
  });
});

describe("chunking", () => {
  it("keeps short text whole and splits long text without loss", () => {
    expect(core.chunkText("hi")).toEqual(["hi"]);
    const long = "x".repeat(250);
    expect(core.chunkText(long, 100)).toEqual(["x".repeat(100), "x".repeat(100), "x".repeat(50)]);
  });
});

/* ── R2: catalogue projection ─────────────────────────────────────────────── */

const sample = JSON.parse(
  readFileSync(new URL("../tests/fixtures/conformance/models-dev-sample.json", import.meta.url), "utf8")
);

describe("projectCatalog", () => {
  const catalog = core.projectCatalog(sample);

  it("projects {providers, modelsById, reasoning} and nothing else", () => {
    expect(Object.keys(catalog).sort()).toEqual(["modelsById", "providers", "reasoning"]);
  });

  it("folds alias twins onto one provider id", () => {
    const ids = catalog.providers.map((row) => row.id);
    expect(ids).toContain("moonshotai");
    expect(ids).not.toContain("moonshot");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps model ids and display names per provider", () => {
    const openai = catalog.modelsById.openai;
    expect(openai.length).toBeGreaterThan(5);
    expect(openai.find((model) => model.value === "gpt-5.6").label).toBe("GPT-5.6");
    expect(openai.some((model) => model.value === "gpt-5.6-sol")).toBe(true);
  });

  it("sorts model rows numerically by label", () => {
    const labels = catalog.modelsById.moonshotai.map((model) => model.label);
    expect(labels.indexOf("Kimi K3")).toBeLessThan(labels.indexOf("Kimi K3.1 Pro"));
    expect(labels.indexOf("Kimi K2.6")).toBeLessThan(labels.indexOf("Kimi K2.7 Code"));
  });

  it("records the reasoning levels each model declares", () => {
    expect(catalog.reasoning.openai["gpt-5.6"]).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
    expect(catalog.reasoning.openai["gpt-4o"]).toBeUndefined();
    expect(catalog.reasoning.anthropic["claude-sonnet-4-5"]).toEqual(["none"]);
  });

  it("survives an empty or hostile payload", () => {
    expect(core.projectCatalog({})).toEqual({ providers: [], modelsById: {}, reasoning: {} });
    expect(core.projectCatalog(null).providers).toEqual([]);
    expect(core.projectCatalog({ x: { models: null } }).modelsById.x).toEqual([]);
  });
});

/* ── R2: one alphabetical list, no divider ────────────────────────────────── */

describe("buildProviderList", () => {
  const catalog = core.projectCatalog(sample);
  const rows = core.buildProviderList(catalog);

  it("merges built-ins and models.dev without duplicates", () => {
    const values = rows.map((row) => row.value);
    expect(new Set(values).size).toBe(values.length);
    expect(rows.filter((row) => row.source === "built-in").length).toBeGreaterThanOrEqual(5);
    expect(rows.filter((row) => row.source === "models.dev").length).toBeGreaterThan(0);
  });

  it("is alphabetical by label across both sources, with no divider rows", () => {
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    const labels = rows.map((row) => row.label);
    for (let i = 1; i < labels.length; i += 1) {
      expect(collator.compare(labels[i - 1], labels[i])).toBeLessThanOrEqual(0);
    }
    expect(rows.some((row) => row.disabled)).toBe(false);
    expect(rows.some((row) => /(^|\s)(more|\u2500{2,})/i.test(row.label))).toBe(false);
    expect(rows.some((row) => /^__/.test(row.value))).toBe(false);
  });

  it("collapses the built-in/models.dev alias twin onto the built-in row", () => {
    const byValue = Object.fromEntries(rows.map((row) => [row.value, row]));
    expect(byValue["google-gemini"].source).toBe("built-in");
    expect(byValue["google-gemini"].label).toBe("Google Gemini");
    expect(byValue["google-gemini"].catalogId).toBe("google");
    expect(rows.some((row) => row.value === "google")).toBe(false);
  });

  it("carries the API base every row needs for the endpoint autofill", () => {
    for (const row of rows.filter((entry) => entry.source === "built-in")) {
      expect(row.api).toMatch(/^https:\/\//);
    }
    // The zhipu built-in replaced its models.dev twin and kept that vendor's API base.
    const zhipu = rows.find((row) => row.value === "zhipu");
    expect(zhipu.catalogId).toBe("zhipuai");
    expect(zhipu.api).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(rows.every((row) => row.source !== "models.dev" || row.api !== "" || row.catalogId !== "")).toBe(true);
  });

  it("puts custom providers last and drops ones that shadow a catalogue id", () => {
    const withCustom = core.buildProviderList(catalog, [
      { value: "corp-gateway", label: "AAA Corp Gateway", api: "https://gw.example/v1" },
      { value: "openai", label: "Shadowed OpenAI", api: "https://shadow.example/v1" },
    ]);
    const last = withCustom[withCustom.length - 1];
    expect(last.value).toBe("corp-gateway");
    expect(last.source).toBe("custom");
    expect(withCustom.filter((row) => row.value === "openai").length).toBe(1);
  });

  it("still offers the built-ins when the catalogue is empty (offline)", () => {
    const offline = core.buildProviderList(core.projectCatalog({}));
    expect(offline.length).toBe(core.BUILTIN_PROVIDERS.length);
    expect(offline.every((row) => row.source === "built-in")).toBe(true);
  });
});

describe("modelsForProvider", () => {
  const catalog = core.projectCatalog(sample);

  it("returns the model rows for a catalogue provider", () => {
    const rows = core.modelsForProvider(catalog, "deepseek");
    expect(rows.map((row) => row.value)).toContain("deepseek-v4-pro");
  });

  it("falls back to the twin's models for a built-in with a renamed catalogue id", () => {
    const rows = core.modelsForProvider(catalog, "qwen");
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.some((row) => row.value === "qwen3-max")).toBe(true);
  });

  it("returns an empty list offline instead of throwing", () => {
    expect(core.modelsForProvider(core.projectCatalog({}), "openai")).toEqual([]);
    expect(core.modelsForProvider(null, "nothing")).toEqual([]);
  });
});

/* ── R1: language picker ──────────────────────────────────────────────────── */

describe("languageOptions", () => {
  const names = JSON.parse(readFileSync(new URL("../tests/fixtures/conformance/language-names.json", import.meta.url), "utf8"));

  it("offers readable labels for every code", () => {
    const rows = core.languageOptions(names, "zh-CN");
    expect(rows.length).toBe(Object.keys(names).length);
    expect(rows.every((row) => row.label !== row.value)).toBe(true);
    expect(rows.find((row) => row.value === "zh-CN").label).toBe("Chinese (Simplified) (zh-CN)");
  });

  it("never offers auto as a target", () => {
    expect(core.languageOptions({ ...names, auto: "Detect" }, "en").some((row) => row.value === "auto")).toBe(false);
    expect(core.languageOptions(names, "en").some((row) => /^auto$/i.test(row.value))).toBe(false);
  });

  it("keeps the stored value even when the table lost it", () => {
    const rows = core.languageOptions({ en: "English" }, "xx-YY");
    expect(rows.some((row) => row.value === "xx-YY")).toBe(true);
  });

  it("is alphabetical by label", () => {
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    const labels = core.languageOptions(names, "en").map((row) => row.label);
    for (let i = 1; i < labels.length; i += 1) expect(collator.compare(labels[i - 1], labels[i])).toBeLessThanOrEqual(0);
  });
});

/* ── R3: endpoint autofill + override ─────────────────────────────────────── */

describe("resolveEndpointOnProviderChange", () => {
  const catalog = core.projectCatalog(sample);
  const providers = core.buildProviderList(catalog);

  it("fills the new provider's API when the field was untouched", () => {
    expect(core.resolveEndpointOnProviderChange("", "", "deepseek", providers)).toBe("https://api.deepseek.com/v1");
    expect(core.resolveEndpointOnProviderChange("https://api.openai.com/v1", "openai", "deepseek", providers)).toBe(
      "https://api.deepseek.com/v1"
    );
    expect(core.resolveEndpointOnProviderChange("https://api.openai.com/v1", "openai", "groq", providers)).toBe(
      "https://api.groq.com/openai/v1"
    );
  });

  it("never overwrites a user-typed endpoint", () => {
    const override = "https://proxy.example/v1";
    expect(core.resolveEndpointOnProviderChange(override, "openai", "deepseek", providers)).toBe(override);
    expect(core.resolveEndpointOnProviderChange("not a url", "openai", "anthropic", providers)).toBe("not a url");
  });

  it("keeps the current value when the new provider has no API base", () => {
    expect(core.resolveEndpointOnProviderChange("https://x.example/v1", "openai", "unknown", providers)).toBe(
      "https://x.example/v1"
    );
  });

  it("treats a trailing slash as the same endpoint", () => {
    expect(core.resolveEndpointOnProviderChange("https://api.openai.com/v1/", "openai", "groq", providers)).toBe(
      "https://api.groq.com/openai/v1"
    );
  });
});

/* ── R4: the "lowest" sentinel ────────────────────────────────────────────── */

describe("resolveReasoningDepth", () => {
  it("exposes the sentinel", () => {
    expect(core.LOWEST).toBe("lowest");
  });

  it("resolves lowest -> none -> minimal -> low", () => {
    expect(core.resolveReasoningDepth("lowest", ["none", "minimal", "low"])).toBe("none");
    expect(core.resolveReasoningDepth("lowest", ["minimal", "low"])).toBe("minimal");
    expect(core.resolveReasoningDepth("lowest", ["low", "medium"])).toBe("low");
  });

  it("sends nothing when the model declares nothing", () => {
    expect(core.resolveReasoningDepth("lowest", [])).toBe("");
    expect(core.resolveReasoningDepth("lowest", null)).toBe("");
  });

  it("honours a concrete setting the model accepts and ignores one it does not", () => {
    expect(core.resolveReasoningDepth("high", ["none", "low", "high"])).toBe("high");
    expect(core.resolveReasoningDepth("max", ["none", "low"])).toBe("none");
  });

  it("builds picker rows with the sentinel first", () => {
    const rows = core.reasoningLevels("lowest", ["none", "low", "high"]);
    expect(rows[0].value).toBe("lowest");
    expect(rows.map((row) => row.value)).toEqual(["lowest", "none", "low", "high"]);
  });
});

describe("buildChatPayload reasoning field", () => {
  it("sends reasoning_effort when a depth resolves", () => {
    const payload = core.buildChatPayload("gpt-5.6", "Hello", "zh-CN", { reasoning: "none" });
    expect(payload.reasoning_effort).toBe("none");
  });

  it("omits the field entirely when there is nothing to send", () => {
    expect(core.buildChatPayload("gpt-4o", "Hello", "zh-CN", { reasoning: "" })).not.toHaveProperty("reasoning_effort");
    expect(core.buildChatPayload("gpt-4o", "Hello", "zh-CN")).not.toHaveProperty("reasoning_effort");
  });

  it("keeps the translation contract intact", () => {
    const payload = core.buildChatPayload("gpt-5.6", "Hello", "zh-CN", { reasoning: "none" });
    expect(payload.model).toBe("gpt-5.6");
    expect(payload.stream).toBe(false);
    expect(payload.messages[1].content).toBe("Hello");
  });
});
