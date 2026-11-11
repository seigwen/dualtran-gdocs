import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import i18n from "../I18N.gs";

const source = readFileSync(new URL("../I18N.gs", import.meta.url), "utf8");
const panelHtml = readFileSync(new URL("../Sidebar.html", import.meta.url), "utf8");
const code = readFileSync(new URL("../Code.gs", import.meta.url), "utf8");
const { DUALTRAN_I18N: table, DUALTRAN_I18N_LOCALES: locales, t, DUALTranI18NTable, DUALTranI18NPanel } = i18n;

/** Every string the panel surface can show. Keep this list in sync with Sidebar.html/Code.gs. */
const PANEL_KEYS = [
  "title",
  "target",
  "provider",
  "model",
  "endpoint",
  "reasoning",
  "apiKey",
  "engine",
  "engineGoogle",
  "engineAi",
  "translate",
  "save",
  "openSidebar",
  "cardHint",
  "statusTranslating",
  "statusSaved",
  "statusTranslated",
  "statusNoSelection",
  "statusCatalogOffline",
  "endpointHint",
  "customModel",
  "customProvider",
];

describe("locale matrix", () => {
  it("ships exactly 38 locales", () => {
    expect(locales.length).toBe(38);
    expect(new Set(locales).size).toBe(38);
  });

  it("matches the locales VS Code already ships for this product family", () => {
    const vscode = JSON.parse(readFileSync(new URL("../tests/fixtures/conformance/i18n-extra-vscode.json", import.meta.url), "utf8"));
    const expected = ["en", ...Object.keys(vscode).filter((key) => !/^pickModel/.test(key))];
    expect([...locales].sort()).toEqual([...expected].sort());
  });

  it("has a message table for every listed locale", () => {
    for (const locale of locales) expect(table[locale], locale).toBeTypeOf("object");
    expect(Object.keys(table).sort()).toEqual([...locales].sort());
  });
});

describe("key parity", () => {
  it("covers all ~16 panel strings", () => {
    expect(Object.keys(table.en).sort()).toEqual([...PANEL_KEYS].sort());
  });

  it("gives every locale exactly the English key set, all non-empty", () => {
    const english = Object.keys(table.en).sort();
    for (const locale of locales) {
      expect(Object.keys(table[locale]).sort(), locale).toEqual(english);
      for (const key of english) {
        expect(typeof table[locale][key], `${locale}.${key}`).toBe("string");
        expect(table[locale][key].trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("keeps every {PLACEHOLDER} for every locale", () => {
    for (const locale of locales) {
      for (const key of Object.keys(table.en)) {
        const expected = [...table.en[key].matchAll(/\{([A-Z][A-Z0-9_]*)\}/g)].map((match) => match[1]);
        const actual = [...table[locale][key].matchAll(/\{([A-Z][A-Z0-9_]*)\}/g)].map((match) => match[1]);
        expect(actual.sort(), `${locale}.${key}`).toEqual(expected.sort());
      }
    }
  });

  it("hand-writes zh_CN and zh_TW instead of copying English", () => {
    for (const locale of ["zh_CN", "zh_TW"]) {
      const differs = Object.keys(table.en).filter((key) => table[locale][key] !== table.en[key]);
      expect(differs.length, locale).toBeGreaterThanOrEqual(18);
    }
    expect(table.zh_CN.provider).toBe("服务商");
    expect(table.zh_TW.provider).toBe("服務供應商");
    expect(table.zh_TW.statusTranslated).toContain("{COUNT}");
  });

  it("never leaks CJK text into a Latin-script locale", () => {
    for (const locale of locales.filter((name) => !/^(zh_|ja)/.test(name))) {
      for (const key of Object.keys(table.en)) {
        expect(/[\u3400-\u9fff]/.test(table[locale][key]), `${locale}.${key}`).toBe(false);
      }
    }
  });
});

describe("t(locale, key)", () => {
  it("returns the locale's own string", () => {
    expect(t("zh_CN", "translate")).toBe("翻译所选内容");
    expect(t("en", "translate")).toBe("Translate selection");
  });

  it("falls back to English, then to the key itself", () => {
    expect(t("xx_YY", "model")).toBe(table.en.model);
    expect(t("en", "notAKey")).toBe("notAKey");
  });

  it("does not resolve inherited object properties", () => {
    expect(t("en", "constructor")).toBe("constructor");
    expect(t("en", "toString")).toBe("toString");
  });
});

describe("account locale mapping", () => {
  it("maps Google account locales onto the matrix", () => {
    expect(DUALTranI18NTable("zh-CN")).toBe("zh_CN");
    expect(DUALTranI18NTable("zh-TW")).toBe("zh_TW");
    expect(DUALTranI18NTable("pt-BR")).toBe("pt_BR");
    expect(DUALTranI18NTable("pt-PT")).toBe("pt_PT");
    expect(DUALTranI18NTable("de-AT")).toBe("de");
    expect(DUALTranI18NTable("no")).toBe("no");
  });

  it("falls back to English for locales the matrix does not ship", () => {
    expect(DUALTranI18NTable("am")).toBe("en");
    expect(DUALTranI18NTable("")).toBe("en");
    expect(DUALTranI18NTable(undefined)).toBe("en");
  });

  it("only ever returns a shipped locale", () => {
    for (const region of ["en-US", "ja-JP", "ko-KR", "sr-Latn", "zh-Hant-HK", "zz-ZZ"]) {
      expect(locales, region).toContain(DUALTranI18NTable(region));
    }
  });
});

describe("panel payload + filling", () => {
  it("resolves every key for a locale", () => {
    const ui = DUALTranI18NPanel("zh_TW");
    expect(Object.keys(ui).sort()).toEqual(Object.keys(table.en).sort());
    expect(ui.title).toBe("DualTran 翻譯");
  });

  it("substitutes {NAME} placeholders and leaves unknown ones visible", () => {
    expect(i18n.DUALTranI18NFill("Translated {COUNT} paragraph(s).", { COUNT: 3 })).toBe("Translated 3 paragraph(s).");
    expect(i18n.DUALTranI18NFill("{COUNT} of {TOTAL}", { COUNT: 1 })).toBe("1 of {TOTAL}");
  });
});

describe("the UI reads no hard-coded copy", () => {
  it("Sidebar.html labels every visible string through data-i18n or t()", () => {
    const labels = [...panelHtml.matchAll(/<label[^>]*>(?:.*?)<\/label>/g)].map((match) => match[0]);
    expect(labels.length).toBeGreaterThan(3);
    for (const label of labels) expect(label).toMatch(/data-i18n="[a-zA-Z]+"/);
  });

  it("uses only keys that exist in the matrix", () => {
    const used = [
      ...[...panelHtml.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]),
      ...[...panelHtml.matchAll(/\bt\("([^"]+)"\)/g)].map((match) => match[1]),
      ...[...code.matchAll(/\bui\.([a-zA-Z]+)/g)].map((match) => match[1]),
    ];
    expect(used.length).toBeGreaterThan(10);
    for (const key of new Set(used)) expect(Object.keys(table.en), key).toContain(key);
  });

  it("Code.gs keeps user-facing sentences out of string literals", () => {
    expect(code).not.toMatch(/alert\("Select at least/);
    expect(code).not.toMatch(/statusTranslated", \{ count/);
    expect(code).toContain("DUALTranI18NPanel(");
  });

  it("I18N.gs parses as plain JavaScript", () => {
    expect(() => new Function(source)).not.toThrow();
  });
});
