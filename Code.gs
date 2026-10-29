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
  endpoint: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
};

function onOpen() {
  DocumentApp.getUi()
    .createMenu("DualTran")
    .addItem("Translate selection", "translateSelection")
    .addItem("Open sidebar", "showSidebar")
    .addToUi();
}

function onDocsHomepage() {
  return buildCard();
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile("Sidebar").setTitle("DualTran Translate");
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
  Object.keys(patch || {}).forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
      PROPS.setProperty(key, String(patch[key]));
    }
  });
  return getSettings();
}

function translateText(text, settings) {
  settings = settings || getSettings();
  if (settings.engine === "google") {
    var response = UrlFetchApp.fetch(DualTranCore.googleUrl(text, settings.target), {
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) {
      throw new Error("Google Translate returned HTTP " + response.getResponseCode());
    }
    return DualTranCore.parseGoogleResponse(JSON.parse(response.getContentText()));
  }

  var payload = DualTranCore.buildChatPayload(settings.model, text, settings.target);
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

function translateChunked(text, settings) {
  return DualTranCore.chunkText(text)
    .map(function (chunk) {
      return translateText(chunk, settings);
    })
    .join("\n\n");
}

/** Insert the translation below each selected paragraph, leaving the original untouched. */
function translateSelection() {
  var doc = DocumentApp.getActiveDocument();
  var selection = doc.getSelection();
  if (!selection) {
    DocumentApp.getUi().alert("Select at least one paragraph first.");
    return { translated: 0, error: null };
  }

  var settings = getSettings();
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

  return { translated: translated, error: null };
}

/** Sidebar entry point: persist the form, then translate. */
function saveAndTranslate(patch) {
  saveSettings(patch);
  return translateSelectionFromUi();
}

/** Called from the sidebar; never throws so the UI can show the message. */
function translateSelectionFromUi() {
  try {
    var result = translateSelection();
    return { ok: true, translated: result.translated, message: "Translated " + result.translated + " paragraph(s)." };
  } catch (error) {
    return { ok: false, translated: 0, message: String(error && error.message ? error.message : error) };
  }
}

function buildCard() {
  var card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle("DualTran Translate"));
  card.addSection(
    CardService.newCardSection().addWidget(
      CardService.newTextParagraph().setText(
        "Select paragraphs in the document, then use <b>DualTran → Translate selection</b>. " +
          "The translation is inserted below the original."
      )
    )
  );
  return card.build();
}
