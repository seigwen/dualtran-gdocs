import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const code = readFileSync(new URL("../Code.gs", import.meta.url), "utf8");

describe("Docs add-on entry points", () => {
  it("parses as JavaScript", () => {
    expect(() => new Function(code)).not.toThrow();
  });

  it("uses Apps Script's built-in Language service for the no-key engine", () => {
    expect(code).toContain("LanguageApp.translate(");
    expect(code).not.toContain("UrlFetchApp.fetch(DualTranCore.googleUrl");
  });

  it("still builds an AI request for the BYOK engine", () => {
    expect(code).toContain("DualTranCore.chatCompletionsUrl");
    expect(code).toContain("DualTranCore.buildChatPayload");
  });
});
