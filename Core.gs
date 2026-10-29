/**
 * Pure translation helpers, shared by the Apps Script runtime and the Node test suite.
 *
 * Apps Script loads this file with `eval`-free `include` semantics (every .gs file shares one
 * global scope), so the module also assigns to `globalThis`. Node picks it up through
 * `module.exports`.
 */
(function (root) {
  "use strict";

  var GOOGLE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";

  function normalizeEndpoint(endpoint) {
    var trimmed = String(endpoint || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(trimmed)) {
      throw new Error('Endpoint must start with http:// or https:// (got "' + endpoint + '")');
    }
    return trimmed;
  }

  function chatCompletionsUrl(endpoint) {
    var base = normalizeEndpoint(endpoint);
    if (/\/chat\/completions$/i.test(base)) return base;
    if (/\/v\d+$/i.test(base)) return base + "/chat/completions";
    return base + "/v1/chat/completions";
  }

  function buildChatPayload(model, text, target) {
    return {
      model: model,
      temperature: 0,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You translate into " + target + ". Return only the translation, no commentary, " +
            "no quotes, and keep names, numbers, citations and inline links exactly as they " +
            "appear. If the text is already in " + target + ", return it unchanged.",
        },
        { role: "user", content: text },
      ],
    };
  }

  function parseChatResponse(payload) {
    if (payload && payload.error && payload.error.message) throw new Error(payload.error.message);
    var choice = payload && payload.choices && payload.choices[0];
    var content = choice && choice.message && choice.message.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("The provider returned an empty translation");
    }
    return content.trim();
  }

  function googleUrl(text, target, source) {
    var params =
      "client=gtx&sl=" + encodeURIComponent(source || "auto") +
      "&tl=" + encodeURIComponent(target) +
      "&dt=t&q=" + encodeURIComponent(text);
    return GOOGLE_ENDPOINT + "?" + params;
  }

  function parseGoogleResponse(payload) {
    var rows = payload && payload[0];
    if (!Array.isArray(rows)) throw new Error("Unexpected response from Google Translate");
    var text = rows
      .map(function (row) { return Array.isArray(row) && row[0] ? String(row[0]) : ""; })
      .join("")
      .trim();
    if (!text) throw new Error("Google Translate returned an empty translation");
    return text;
  }

  /** Google Translate rejects very long queries, so paragraphs are sent in order, one call each. */
  function chunkText(text, limit) {
    limit = limit || 1800;
    var clean = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!clean) return [];
    if (clean.length <= limit) return [clean];
    var parts = [];
    var current = "";
    clean.split(/\n{2,}/).forEach(function (paragraph) {
      if ((current + "\n\n" + paragraph).trim().length <= limit) {
        current = current ? current + "\n\n" + paragraph : paragraph;
        return;
      }
      if (current) parts.push(current);
      if (paragraph.length <= limit) {
        current = paragraph;
        return;
      }
      for (var i = 0; i < paragraph.length; i += limit) parts.push(paragraph.slice(i, i + limit));
      current = "";
    });
    if (current) parts.push(current);
    return parts;
  }

  var api = {
    normalizeEndpoint: normalizeEndpoint,
    chatCompletionsUrl: chatCompletionsUrl,
    buildChatPayload: buildChatPayload,
    parseChatResponse: parseChatResponse,
    googleUrl: googleUrl,
    parseGoogleResponse: parseGoogleResponse,
    chunkText: chunkText,
  };

  root.DualTranCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
