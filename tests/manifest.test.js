import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../appsscript.json", import.meta.url), "utf8"));

describe("Apps Script manifest", () => {
  it("whitelists every endpoint the add-on can call", () => {
    const whitelist = manifest.urlFetchWhitelist ?? [];
    expect(whitelist).toContain("https://translate.googleapis.com/");
    expect(whitelist).toContain("https://api.openai.com/");
    expect(whitelist).toContain("https://api.deepseek.com/");
    expect(whitelist).toContain("https://openrouter.ai/");
  });

  it("keeps the whitelist server-reachable and https-only", () => {
    for (const prefix of manifest.urlFetchWhitelist ?? []) {
      expect(prefix.startsWith("https://")).toBe(true);
      expect(prefix).not.toContain("localhost");
      expect(prefix).not.toContain("127.0.0.1");
    }
  });
});
