/**
 * Minimal Apps Script shim so the real .gs files can be loaded in Node.
 *
 * The .gs modules are single-scope scripts (Apps Script concatenates them). In Node we
 * evaluate each file as a script inside one `vm` context, so top-level `var`/`function`
 * declarations land on the shared global exactly as they do in Apps Script. Nothing here
 * invents behaviour the add-on does not have: the service objects are either the real pure
 * helpers from the repo or trivial recorders used to capture what the code sent.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Outer-realm built-ins shared with the vm context (see loadAddon). */
export const hostObject = Object;
export const hostArray = Array;

export function readRepoFile(relative) {
  return readFileSync(resolve(repoRoot, relative), "utf8");
}

/** In-memory PropertiesService/CacheService stand-ins (one script's worth of storage). */
export function createStorage() {
  const props = new Map();
  const cache = new Map();
  const propsService = {
    getProperty: (key) => (props.has(key) ? props.get(key) : null),
    setProperty: (key, value) => {
      props.set(key, String(value));
      return propsService;
    },
    deleteProperty: (key) => {
      props.delete(key);
      return propsService;
    },
    getProperties: () => Object.fromEntries(props),
    setProperties: (values) => {
      for (const [key, value] of Object.entries(values)) props.set(key, String(value));
      return propsService;
    },
  };
  const cacheService = {
    get: (key) => (cache.has(key) ? cache.get(key) : null),
    put: (key, value) => {
      cache.set(key, String(value));
      return cacheService;
    },
    remove: (key) => {
      cache.delete(key);
      return cacheService;
    },
  };
  return { props, cache, propsService, cacheService, clear: () => { props.clear(); cache.clear(); } };
}

/**
 * Load the add-on sources into one V8 context.
 *
 * `sources` defaults to every .gs file in the repo, so new modules (I18N.gs) are picked up
 * without editing this shim.
 */
export function loadAddon({ sources, storage = createStorage(), locale = "en", fetchImpl = null } = {}) {
  const files = sources ?? ["Core.gs", "I18N.gs", "Code.gs"].filter((file) => {
    try {
      readRepoFile(file);
      return true;
    } catch {
      return false;
    }
  });
  const fetches = [];
  // Host-realm built-ins: objects built inside the .gs code carry the vm context's prototype,
  // so the outer realm's Array.isArray/Object.keys would not recognise them. Handing over the
  // host Array/Object reproduces Apps Script's single-realm semantics.
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    String,
    Number,
    Object: hostObject,
    Array: hostArray,
    Boolean,
    encodeURIComponent,
    decodeURIComponent,
    isNaN,
  };

  sandbox.PropertiesService = { getScriptProperties: () => storage.propsService };
  sandbox.CacheService = { getScriptCache: () => storage.cacheService };
  sandbox.Session = { getActiveUserLocale: () => locale };
  sandbox.UrlFetchApp = {
    fetch: (url, params) => {
      fetches.push({ url: String(url), params });
      if (!fetchImpl) throw new Error("UrlFetchApp is not available in this harness");
      return fetchImpl(String(url), params);
    },
  };
  sandbox.LanguageApp = {
    translate: (text) => `[${text}]`,
  };
  sandbox.HtmlService = {
    createHtmlOutputFromFile: () => ({ setTitle: () => ({}) }),
  };
  sandbox.DocumentApp = {
    getUi: () => ({ showSidebar() {}, alert() {}, createMenu: () => ({ addItem: () => ({ addToUi() {} }) }) }),
    getActiveDocument: () => ({ getSelection: () => null }),
    ElementType: { PARAGRAPH: "PARAGRAPH" },
    Attribute: { FOREGROUND_COLOR: "FOREGROUND_COLOR", ITALIC: "ITALIC" },
  };

  const context = vm.createContext(sandbox);
  for (const file of files) {
    const code = readRepoFile(file);
    new vm.Script(code, { filename: file }).runInContext(context);
  }
  return { context, sandbox, storage, fetches, files };
}
