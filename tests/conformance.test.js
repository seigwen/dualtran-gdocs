import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const runner = fileURLToPath(new URL("../scripts/conformance/run.mjs", import.meta.url));

describe("host conformance (SPEC 2.0.0)", () => {
  it("passes every product rule against the real settings surface", () => {
    const result = spawnSync(process.execPath, [runner], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    });
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/\[(R\d|SPEC|STATIC)\]/);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^PASS dualtran-gdocs: \d+ languages, \d+ providers, \d+ locales \(spec 2\.0\.0\)/m);
  });
});
