/**
 * DualTran Translate — Google Docs add-on.
 *
 * Select paragraphs in a document, open the sidebar and translate: the translation is inserted
 * as a new paragraph directly below the original, in a muted colour, so nothing is overwritten.
 */

var PROPS = PropertiesService.getScriptProperties();
var DEFAULTS = {
  engine: "google",
  target: "zh-CN",
  provider: "openai",
  endpoint: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-5.4-mini",
  reasoning: "lowest",
};

/** Only these keys may be written by the sidebar. */
var SETTING_KEYS = ["engine", "target", "provider", "endpoint", "apiKey", "model", "reasoning"];

var CATALOG_URL = "https://models.dev/api.json";
var CATALOG_CACHE_KEY = "catalog:v1";
var CATALOG_CACHE_SECONDS = 24 * 60 * 60;

function onOpen() {
  var ui = DUALTranI18NPanel(activeLocale());
  DocumentApp.getUi()
    .createMenu(ui.title)
    .addItem(ui.translate, "translateSelection")
    .addItem(ui.openSidebar, "showSidebar")
    .addToUi();
}

function onDocsHomepage() {
  return buildCard();
}

function showSidebar() {
  var ui = DUALTranI18NPanel(activeLocale());
  var html = HtmlService.createHtmlOutputFromFile("Sidebar").setTitle(ui.title);
  DocumentApp.getUi().showSidebar(html);
}

function getSettings() {
  var settings = {};
  Object.keys(DEFAULTS).forEach(function (key) {
    var stored = PROPS.getProperty(key);
    settings[key] = stored === null || stored === "" ? DEFAULTS[key] : stored;
  });
  return settings;
}

function saveSettings(patch) {
  var previous = getSettings();
  Object.keys(patch || {}).forEach(function (key) {
    if (SETTING_KEYS.indexOf(key) !== -1) {
      var value = patch[key] === null || patch[key] === undefined ? "" : String(patch[key]).trim();
      if (value === "") {
        PROPS.deleteProperty(key);
      } else {
        PROPS.setProperty(key, value);
      }
    }
  });
  // The model list belongs to the provider: switching provider without naming a model
  // must not leave the old provider's model stored (and sent) under the new one.
  if (patch && patch.provider && previous.provider !== String(patch.provider) && !patch.model) {
    PROPS.deleteProperty("model");
  }
  return getSettings();
}

/** The language picker: human-readable names for every code the stored target may use. */
function getLanguageOptions() {
  return DualTranCore.languageOptions(DUALTRAN_LANGUAGES, getSettings().target);
}

function getLanguageNames() {
  return DUALTRAN_LANGUAGES;
}

/**
 * The catalogue projection: `{providers, modelsById, reasoning}`.
 *
 * Live: https://models.dev/api.json (whitelisted in appsscript.json), projected down to what
 * the sidebar needs and cached for 24h. Offline or throttled: the built-ins alone with no
 * models, so the panel still renders and the endpoint/model can be typed by hand.
 */
function getCatalog() {
  var cache = CacheService.getScriptCache();
  var fresh = readCachedCatalog(cache);
  if (fresh) return fresh;

  // Only a successful fetch is cached: caching the offline fallback would pin an empty
  // model list for 24h after the network comes back.
  try {
    var response = UrlFetchApp.fetch(CATALOG_URL, { muteHttpExceptions: true });
    var code = response.getResponseCode();
    if (code !== 200) throw new Error("models.dev returned HTTP " + code);
    var projected = DualTranCore.projectCatalog(JSON.parse(response.getContentText()));
    writeCachedCatalog(cache, projected);
    return projected;
  } catch (error) {
    return DualTranCore.projectCatalog({});
  }
}

function readCachedCatalog(cache) {
  var stored = null;
  try {
    stored = cache.get(CATALOG_CACHE_KEY);
  } catch (error) {
    stored = null;
  }
  if (!stored) {
    try {
      stored = PROPS.getProperty(CATALOG_CACHE_KEY);
    } catch (error) {
      stored = null;
    }
  }
  if (!stored) return null;
  try {
    var parsed = JSON.parse(stored);
    return parsed && parsed.providers ? parsed : null;
  } catch (error) {
    return null;
  }
}

function writeCachedCatalog(cache, projected) {
  var serialized = JSON.stringify(projected);
  try {
    cache.put(CATALOG_CACHE_KEY, serialized, CATALOG_CACHE_SECONDS);
  } catch (error) {
    // CacheService caps a value at 100KB; the property store is the fallback.
  }
  try {
    PROPS.setProperty(CATALOG_CACHE_KEY, serialized);
  } catch (error) {
    // PropertiesService caps a value at 9KB; a miss just refetches next time.
  }
}

/** The active user's locale, folded onto the 38-locale matrix (en when it is not there). */
function activeLocale() {
  var raw = "";
  try {
    raw = String(Session.getActiveUserLocale() || "");
  } catch (error) {
    raw = "";
  }
  return DUALTranI18NLocale(raw);
}

function getPanelData() {
  var settings = getSettings();
  var catalog = getCatalog();
  var panel = DualTranCore.buildPanelCatalogue(catalog, settings, []);
  var locale = activeLocale();
  return {
    settings: settings,
    locale: locale,
    ui: DUALTranI18NPanel(locale),
    languages: getLanguageOptions(locale),
    providers: panel.providers,
    modelsByProvider: panel.modelsByProvider,
    models: panel.models,
    reasoningByProvider: panel.reasoningByProvider,
    reasoning: panel.reasoning,
    reasoningLevels: DualTranCore.reasoningLevelsFor,
  };
}

function translateText(text, settings) {
  settings = settings || getSettings();
  if (settings.engine === "google") {
    // Apps Script's built-in Language service uses Google Translate without UrlFetchApp.
    // The public translate.googleapis.com endpoint rate-limits shared Apps Script egress
    // with HTTP 429, so prefer the built-in service for the no-key engine.
    var translated = LanguageApp.translate(text, "", settings.target);
    if (!translated || !translated.trim()) {
      throw new Error("Google Translate returned an empty translation");
    }
    return translated.trim();
  }

  var payload = DualTranCore.buildChatPayload(settings.model, text, settings.target, {
    reasoning: resolveRequestedReasoning(settings),
  });
  var headers = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = "Bearer " + settings.apiKey;
  var answer = UrlFetchApp.fetch(DualTranCore.chatCompletionsUrl(settings.endpoint), {
    method: "post",
    contentType: "application/json",
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = answer.getResponseCode();
  if (code !== 200) {
    throw new Error("The provider returned HTTP " + code + ": " + answer.getContentText().slice(0, 160));
  }
  return DualTranCore.parseChatResponse(JSON.parse(answer.getContentText()));
}

/**
 * R4: what to send as the reasoning field for the stored setting and the chosen model.
 * Unknown models (custom endpoints) fall back to the panel's full ladder, so "lowest" still
 * means "none" rather than being dropped.
 */
function resolveRequestedReasoning(settings) {
  var declared = DualTranCore.reasoningForProvider(getCatalog(), settings.provider, settings.model);
  var levels = declared.length ? declared : ["none", "minimal", "low", "medium", "high"];
  return DualTranCore.resolveReasoningDepth(settings.reasoning || DualTranCore.LOWEST, levels);
}

function translateChunked(text, settings) {
  return DualTranCore.chunkText(text)
    .map(function (chunk) {
      return translateText(chunk, settings);
    })
    .join("\n\n");
}

/** Insert the translation below each selected paragraph, leaving the original untouched. */
function translateSelection(settingsToUse) {
  var doc = DocumentApp.getActiveDocument();
  var selection = doc.getSelection();
  var settings = settingsToUse || getSettings();
  var ui = DUALTranI18NPanel(activeLocale());
  if (!selection) {
    var missing = ui.statusNoSelection;
    try {
      DocumentApp.getUi().alert(missing);
    } catch (error) {
      // Headless (onEdit triggers, tests): the caller gets the message instead.
    }
    return { translated: 0, error: null, message: missing };
  }

  var elements = selection.getRangeElements();
  var translated = 0;
  var lastIndex = -1;

  for (var i = elements.length - 1; i >= 0; i -= 1) {
    var element = elements[i].getElement();
    if (element.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    var paragraph = element.asParagraph();
    var text = paragraph.getText();
    if (!text || !text.trim()) continue;

    var output = translateChunked(text, settings);
    var inserted = doc.insertParagraph(lastIndex >= 0 ? lastIndex : doc.getBody().getChildIndex(paragraph) + 1, output);
    inserted.setAttributes({
      [DocumentApp.Attribute.FOREGROUND_COLOR]: "#5f6368",
      [DocumentApp.Attribute.ITALIC]: false,
    });
    lastIndex = doc.getBody().getChildIndex(inserted) + 1;
    translated += 1;
  }

  return { translated: translated, error: null, message: "" };
}

/**
 * Sidebar entry point: persist the whole form (target/provider/model/endpoint/reasoning/
 * apiKey/engine), then translate with exactly what was saved.
 */
function saveAndTranslate(patch) {
  var settings = saveSettings(patch);
  return translateSelectionFromUi(settings);
}

/** Called from the sidebar; never throws so the UI can show the message. */
function translateSelectionFromUi(settings) {
  var ui = DUALTranI18NPanel(activeLocale());
  try {
    var result = translateSelection(settings);
    if (result.message) return { ok: false, translated: 0, message: result.message };
    var count = result.translated;
    return {
      ok: true,
      translated: count,
      message: DUALTranI18NFill(ui.statusTranslated, { COUNT: count }),
    };
  } catch (error) {
    return { ok: false, translated: 0, message: String(error && error.message ? error.message : error) };
  }
}

function buildCard() {
  var ui = DUALTranI18NPanel(activeLocale());
  var card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle(ui.title));
  card.addSection(
    CardService.newCardSection().addWidget(
      CardService.newTextParagraph().setText(ui.cardHint)
    )
  );
  return card.build();
}
