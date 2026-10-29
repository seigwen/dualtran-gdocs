import { describe, expect, it } from "vitest";
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
