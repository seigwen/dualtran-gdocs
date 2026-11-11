#!/usr/bin/env node
/**
 * I18N.gs maintenance: assertion-guarded merge, then regeneration.
 *
 *   1. read the current I18N.gs, evaluate it, and ASSERT the matrix is sound
 *      (every locale in DUALTRAN_I18N_LOCALES present, every locale keyed exactly like `en`)
 *   2. for each locale, merge missing keys from `en` — existing translations are never
 *      touched, no bulk text replacement happens anywhere else in the file
 *   3. re-emit only the `var DUALTRAN_I18N = {...}` block, between exact anchors in the file
 *
 * A locale that loses a key is a hard error (exit 1), not something to paper over.
 *
 * Usage: node scripts/i18n-sync.mjs [--check] [--languages]
 *   --check      fail if I18N.gs is out of date instead of writing it
 *   --languages  also regenerate DUALTRAN_LANGUAGES from tests/fixtures/conformance/language-names.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const i18nPath = resolve(repoRoot, "I18N.gs");
const source = readFileSync(i18nPath, "utf8");

/** Evaluate just the data declarations, with no Apps Script services. */
function loadDeclarations(text) {
  const sandbox = { module: undefined };
  vm.createContext(sandbox);
  new vm.Script(text, { filename: "I18N.gs" }).runInContext(sandbox);
  return sandbox;
}

function assertMatrix(table, locales) {
  const problems = [];
  const warnings = [];
  const english = table.en;
  if (!english) problems.push("DUALTranI18N.en is missing");
  if (locales.length !== 38) problems.push(`DUALTRAN_I18N_LOCALES has ${locales.length} entries, expected 38`);
  if (new Set(locales).size !== locales.length) problems.push("DUALTranI18N_LOCALES has duplicates");

  const expectedKeys = Object.keys(english || {}).sort();
  for (const locale of locales) {
    const messages = table[locale];
    if (!messages) {
      // First run for a new locale: it gets the English strings, reported, not failed.
      warnings.push(`locale "${locale}" has no table yet — filling from en (add real translations)`);
      continue;
    }
    const keys = Object.keys(messages).sort();
    const missing = expectedKeys.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !expectedKeys.includes(key));
    if (extra.length) problems.push(`locale "${locale}" has keys that en does not: ${extra.join(", ")}`);
    if (missing.length) {
      warnings.push(`locale "${locale}" is missing ${missing.join(", ")} — filling from en`);
    }
    for (const key of keys) {
      if (expectedKeys.includes(key) && (typeof messages[key] !== "string" || !messages[key].trim())) {
        problems.push(`locale "${locale}" key "${key}" is blank`);
      }
    }
  }
  for (const locale of Object.keys(table)) {
    if (!locales.includes(locale)) warnings.push(`locale "${locale}" is not in DUALTRAN_I18N_LOCALES — pruning its table`);
  }
  return { problems, warnings };
}

/** Assertion-guarded merge: fill gaps from `en`, never overwrite an existing string. */
function mergeLocale(english, messages) {
  const merged = {};
  let filled = 0;
  for (const key of Object.keys(english)) {
    const existing = messages && typeof messages[key] === "string" && messages[key].trim() ? messages[key] : null;
    if (!existing) filled += 1;
    merged[key] = existing || english[key];
  }
  return { merged, filled };
}

function quote(value) {
  return JSON.stringify(value);
}

function emitTable(table, locales) {
  const lines = ["var DUALTRAN_I18N = {"];
  // `en` is the source locale: always first, so the file shape is stable across runs.
  for (const locale of ["en", ...locales.filter((name) => name !== "en")]) {
    lines.push(`  ${locale}: {`);
    for (const [key, value] of Object.entries(table.en)) {
      lines.push(`    ${key}: ${quote(table[locale][key])},`);
    }
    lines.push("  },");
  }
  lines.push("};");
  return lines.join("\n");
}

function replaceTable(text, block) {
  const anchor = "var DUALTRAN_I18N = {";
  const start = text.indexOf(anchor);
  if (start === -1) throw new Error("I18N.gs: anchor 'var DUALTRAN_I18N = {' not found");
  const end = text.indexOf("\n};", start);
  if (end === -1) throw new Error("I18N.gs: closing '};' for DUALTRAN_I18N not found");
  // `block` opens with the same "var DUALTRAN_I18N = {" line, so it replaces it whole.
  const tail = text.slice(end + "\n};".length);
  return text.slice(0, start) + block + tail;
}

function replaceLanguages(text, names) {
  const start = text.indexOf("var DUALTRAN_LANGUAGES = {");
  if (start === -1) throw new Error("I18N.gs: anchor 'var DUALTRAN_LANGUAGES = {' not found");
  const end = text.indexOf("\n};\n", start);
  if (end === -1) throw new Error("I18N.gs: closing '};' for DUALTRAN_LANGUAGES not found");
  const body = Object.keys(names)
    .sort()
    .map((code) => `  ${/^[A-Za-z]+$/.test(code) ? code : quote(code)}: ${quote(names[code])},`)
    .join("\n");
  return `${text.slice(0, start)}var DUALTRAN_LANGUAGES = {\n${body}\n};${text.slice(end + "\n};".length)}`;
}

const args = process.argv.slice(2);
const declarations = loadDeclarations(source);
const locales = declarations.DUALTRAN_I18N_LOCALES;
const table = declarations.DUALTRAN_I18N;

const { problems, warnings } = assertMatrix(table, locales);
if (problems.length) {
  console.error("I18N.gs matrix assertions failed:\n- " + problems.join("\n- "));
  process.exit(1);
}
if (warnings.length) console.warn("I18N.gs warnings:\n- " + warnings.join("\n- "));

let filledTotal = 0;
const next = {};
for (const locale of locales) {
  const { merged, filled } = mergeLocale(table.en, table[locale]);
  next[locale] = merged;
  filledTotal += filled;
}

let updated = replaceTable(source, emitTable(next, locales));
if (args.includes("--languages")) {
  const names = JSON.parse(readFileSync(resolve(repoRoot, "tests/fixtures/conformance/language-names.json"), "utf8"));
  updated = replaceLanguages(updated, names);
}

if (args.includes("--check")) {
  if (updated !== source) {
    console.error("I18N.gs is out of date — run `npm run i18n:sync`");
    process.exit(1);
  }
  console.log(`I18N.gs OK: ${locales.length} locales, ${Object.keys(table.en).length} keys each, no drift`);
  process.exit(0);
}

writeFileSync(i18nPath, updated);
console.log(
  `I18N.gs updated: ${locales.length} locales x ${Object.keys(table.en).length} keys, ${filledTotal} string(s) filled from en`
);
