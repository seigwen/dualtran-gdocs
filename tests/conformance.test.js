import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const runner = fileURLToPath(new URL("../scripts/conformance/run.mjs", import.meta.url));

describe("host conformance (SPEC 2.1.0)", () => {
  it("passes every product rule against the real settings surface", () => {
    const result = spawnSync(process.execPath, [runner], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    });
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/\[(R\d|SPEC|STATIC)\]/);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^PASS dualtran-gdocs: \d+ languages, \d+ providers, \d+ locales \(spec 2\.1\.0\)/m);
  });

  it("emits both states from the real controls: unconfigured and configured", async () => {
    const { buildPayload } = await import("../scripts/conformance/payload.mjs");
    const payload = await buildPayload();
    const empty = payload.emptyState;

    // Unconfigured: empty provider, disabled selected placeholder, nothing configured.
    expect(empty.provider.current).toBe("");
    expect(empty.provider.placeholder).toMatchObject({ value: "", disabled: true, selected: true });
    expect(empty.provider.placeholder.label).toBe(payload.i18n.files[payload.i18n.locale].providerPlaceholder);
    expect(empty.provider.fallback).toBe("");
    expect(empty.provider.options.some((option) => option.value === "")).toBe(false);
    expect(empty.model.disabled).toBe(true);
    expect(empty.model.options).toEqual([]);
    expect(empty.model.selectedProvider).toBe("");
    expect(empty.endpoint.current).toBe("");
    expect(empty.endpoint.placeholder).toBe("https://");
    expect(empty.reasoning.disabled).toBe(true);
    expect(empty.reasoning.default).toBe("lowest");
    // The guard: nothing is translated, and the answer is the localized providerRequiredError.
    expect(empty.guard.ok).toBe(false);
    expect(empty.guard.translated).toBe(0);
    expect(empty.guard.message).toBe(empty.providerRequiredError);
    expect(payload.guard.message).toBe(empty.providerRequiredError);

    // Choosing a provider fills the endpoint's value with that provider's API base.
    expect(empty.endpoint.afterFirstPick).toMatch(/^https:\/\//);
    expect(empty.endpoint.afterFirstPick).toBe(empty.endpoint.providerApi);

    // Configured: placeholder not selected, model list live, sentinel untouched.
    expect(payload.provider.current).not.toBe("");
    expect(payload.provider.placeholder.selected).toBe(false);
    expect(payload.model.disabled).toBe(false);
    expect(payload.model.selectedProvider).toBe(payload.provider.current);
    expect(payload.endpoint.current).toMatch(/^https:\/\//);
    expect(payload.reasoning.disabled).toBe(false);
  });

  it("never carries an OpenAI endpoint or model in the empty state", async () => {
    const { buildPayload } = await import("../scripts/conformance/payload.mjs");
    const payload = await buildPayload();
    const empty = JSON.stringify(payload.emptyState.settings) + JSON.stringify(payload.emptyState.endpoint);
    expect(empty).not.toContain("api.openai.com");
    expect(empty).not.toMatch(/gpt-/);
  });
});
