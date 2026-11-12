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

  /** R4: the reasoning setting that means "give me the least thinking the model allows". */
  var LOWEST = "lowest";

  var REASONING_PREFERENCE = ["none", "minimal", "low", "medium", "high"];

  /**
   * Built-in providers. They are always in the list (even offline), always carry an API base
   * for the endpoint autofill, and their ids match models.dev where models.dev has the same
   * vendor, so the catalogue entries enrich them instead of duplicating them.
   */
  var BUILTIN_PROVIDERS = [
    { id: "google-gemini", catalogId: "google", label: "Google Gemini", api: "https://generativelanguage.googleapis.com/v1beta/openai" },
    { id: "openai", catalogId: "openai", label: "OpenAI", api: "https://api.openai.com/v1" },
    { id: "anthropic", catalogId: "anthropic", label: "Anthropic", api: "https://api.anthropic.com/v1" },
    { id: "deepseek", catalogId: "deepseek", label: "DeepSeek", api: "https://api.deepseek.com/v1" },
    { id: "openrouter", catalogId: "openrouter", label: "OpenRouter", api: "https://openrouter.ai/api/v1" },
    { id: "moonshot", catalogId: "moonshotai", label: "Moonshot AI", api: "https://api.moonshot.cn/v1" },
    { id: "qwen", catalogId: "alibaba-cn", label: "Qwen (DashScope)", api: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    { id: "zhipu", catalogId: "zhipuai", label: "Zhipu AI (BigModel)", api: "https://open.bigmodel.cn/api/paas/v4" },
    { id: "groq", catalogId: "groq", label: "Groq", api: "https://api.groq.com/openai/v1" },
  ];

  /**
   * One alphabetical provider list: built-ins and models.dev entries merged, a vendor that
   * appears under both names collapsed onto the id the built-in already uses, custom
   * providers last. No section header, no "more…" row — the list is the list.
   */
  var PROVIDER_ALIASES = {
    "google-gemini": "google",
    moonshot: "moonshotai",
    grok: "xai",
    zhipu: "zhipuai",
    qwen: "alibaba-cn",
    together: "togetherai",
    "azure-openai": "azure",
  };

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

  function buildChatPayload(model, text, target, options) {
    options = options || {};
    var payload = {
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
    var reasoning = options.reasoning === undefined ? null : options.reasoning;
    if (reasoning) payload.reasoning_effort = reasoning;
    return payload;
  }

  /**
   * R4. The UI stores one sentinel ("lowest") instead of a concrete effort, so the request
   * asks for the least thinking the chosen model actually declares:
   * "lowest" -> "none" -> "minimal" -> "low". A model that declares no levels sends no
   * reasoning field at all; a concrete stored value is kept only where the model has it.
   */
  function resolveReasoningDepth(setting, levels) {
    var declared = uniqueReasoningLevels(levels);
    if (declared.length === 0) return "";
    if (setting !== LOWEST && declared.indexOf(setting) !== -1) return setting;
    for (var i = 0; i < REASONING_PREFERENCE.length; i += 1) {
      if (declared.indexOf(REASONING_PREFERENCE[i]) !== -1) return REASONING_PREFERENCE[i];
    }
    return declared[0];
  }

  function uniqueReasoningLevels(levels) {
    var out = [];
    (levels || []).forEach(function (level) {
      var value = String(level === undefined || level === null ? "" : level).trim();
      if (value && out.indexOf(value) === -1) out.push(value);
    });
    return out;
  }

  /** Reasoning levels one models.dev model declares (effort values; toggle/budget -> none). */
  function declaredReasoningLevels(model) {
    var options = model && model.reasoning_options;
    if (!Array.isArray(options) || options.length === 0) return [];
    var levels = ["none"];
    options.forEach(function (option) {
      if (!option) return;
      if (option.type === "effort" && Array.isArray(option.values)) {
        levels = levels.concat(option.values);
      }
    });
    return uniqueReasoningLevels(levels);
  }

  /** The picker rows: the sentinel first, then the concrete levels the model accepts. */
  function reasoningLevels(setting, levels) {
    var declared = uniqueReasoningLevels(levels);
    return [{ value: LOWEST, label: "Lowest" }].concat(
      declared.map(function (level) {
        var label = level.charAt(0).toUpperCase() + level.slice(1);
        if (level === resolveReasoningDepth(setting || LOWEST, declared)) label += " ·";
        return { value: level, label: label };
      })
    );
  }

  function providerAlias(id) {
    return PROVIDER_ALIASES[id] || id;
  }

  function builtinProvider(catalogId) {
    for (var i = 0; i < BUILTIN_PROVIDERS.length; i += 1) {
      if (BUILTIN_PROVIDERS[i].id === catalogId || BUILTIN_PROVIDERS[i].catalogId === catalogId) {
        return BUILTIN_PROVIDERS[i];
      }
    }
    return null;
  }

  function normalizeApi(api) {
    var value = String(api === undefined || api === null ? "" : api).trim().replace(/\/+$/, "");
    return /^https?:\/\//i.test(value) ? value : "";
  }

  /**
   * Label order shared with the conformance gate: locale-aware, numeric, case-insensitive,
   * so "GPT-5.9" sorts before "GPT-5.10" instead of after it.
   */
  var LABEL_COLLATOR = typeof Intl !== "undefined" && Intl.Collator
    ? new Intl.Collator("en", { numeric: true, sensitivity: "base" })
    : null;

  function byLabel(a, b) {
    var left = String(a.label || "");
    var right = String(b.label || "");
    var order = LABEL_COLLATOR
      ? LABEL_COLLATOR.compare(left, right)
      : left.toLowerCase() < right.toLowerCase() ? -1 : left.toLowerCase() > right.toLowerCase() ? 1 : 0;
    if (order !== 0) return order;
    var leftValue = String(a.value || "");
    var rightValue = String(b.value || "");
    var tie = LABEL_COLLATOR ? LABEL_COLLATOR.compare(leftValue, rightValue) : leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    return tie;
  }

  /**
   * One catalogue per provider id (aliases already folded in), so the sidebar can swap the
   * model list without another round trip and the endpoint autofill has an API base.
   */
  function catalogIndex(catalog) {
    var index = {};
    var providers = [];
    if (catalog && catalog.providers && typeof catalog.providers.length === "number") {
      for (var j = 0; j < catalog.providers.length; j += 1) providers.push(catalog.providers[j]);
    }
    for (var i = 0; i < providers.length; i += 1) {
      var entry = providers[i];
      if (entry && entry.id) index[entry.id] = entry;
    }
    return index;
  }

  function projectCatalog(raw) {
    var providers = [];
    var modelsById = {};
    var reasoning = {};
    var source = raw && typeof raw === "object" ? raw : {};
    Object.keys(source).forEach(function (key) {
      var entry = source[key];
      if (!entry || typeof entry !== "object") return;
      var id = providerAlias(String(entry.id || key));
      if (!id) return;
      if (!modelsById[id]) {
        modelsById[id] = [];
        reasoning[id] = {};
      } else {
        return; // an alias twin: the first id owns the vendor's model list
      }
      providers.push({ id: id, name: String(entry.name || id), api: normalizeApi(entry.api) });
      var models = entry.models && typeof entry.models === "object" ? entry.models : {};
      Object.keys(models).forEach(function (modelKey) {
        var model = models[modelKey] || {};
        var modelId = String(model.id || modelKey);
        if (!modelId) return;
        var label = String(model.name || modelId);
        modelsById[id].push({ value: modelId, label: label });
        var levels = declaredReasoningLevels(model);
        if (levels.length) reasoning[id][modelId] = levels;
      });
      modelsById[id].sort(byLabel);
    });
    return { providers: providers, modelsById: modelsById, reasoning: reasoning };
  }

  /**
   * R2. Built-ins + models.dev as ONE alphabetical list. A built-in and a models.dev row for
   * the same vendor are alias twins, so they collapse into a single row labelled with the
   * built-in name (the one the add-on documentation uses). Custom providers go last.
   */
  function buildProviderList(catalog, customProviders) {
    var index = catalogIndex(catalog);
    var rows = [];
    var seen = {};
    // Literal rather than Object.create(null)/new Map: Apps Script V8 and the Node test
    // harness both need this list to be a plain array of plain rows.

    function add(entry) {
      if (!entry || !entry.value || seen[entry.value]) return;
      seen[entry.value] = true;
      rows.push(entry);
    }

    var builtins = BUILTIN_PROVIDERS;
    for (var b = 0; b < builtins.length; b += 1) {
      var builtin = builtins[b];
      var twin = index[builtin.id] || index[builtin.catalogId];
      add({
        value: builtin.id,
        label: builtin.label,
        source: "built-in",
        catalogId: twin ? twin.id : "",
        api: builtin.api || (twin ? twin.api : ""),
      });
      // Claim the twin's catalogue id too, so the models.dev row for the same vendor does
      // not come back as a second entry ("Google Gemini" vs "Google").
      if (twin && twin.id !== builtin.id) seen[twin.id] = true;
    }

    var projected = [];
    if (catalog && catalog.providers && typeof catalog.providers.length === "number") {
      for (var p = 0; p < catalog.providers.length; p += 1) projected.push(catalog.providers[p]);
    }
    for (var q = 0; q < projected.length; q += 1) {
      var entry = projected[q];
      if (!entry || !entry.id || seen[entry.id]) continue;
      add({
        value: entry.id,
        label: entry.name || entry.id,
        source: "models.dev",
        catalogId: entry.id,
        api: normalizeApi(entry.api),
      });
    }

    var custom = customProviders || [];
    for (var c = 0; c < custom.length; c += 1) {
      var row = custom[c];
      var id = String((row && (row.value || row.id)) || "").trim();
      if (!id || seen[id]) continue;
      seen[id] = true;
      rows.push({
        value: id,
        label: String(row.label || row.name || id),
        source: "custom",
        catalogId: "",
        api: normalizeApi(row.api),
      });
    }

    var catalogue = rows.filter(function (item) { return item.source !== "custom"; });
    var tail = rows.filter(function (item) { return item.source === "custom"; });
    return catalogue.sort(byLabel).concat(tail);
  }

  /** The model rows for one provider: catalogue models (from its twin when it is a built-in). */
  function modelsForProvider(catalog, providerId, customProviders) {
    var id = String(providerId || "");
    var builtin = builtinProvider(id);
    var lists = (catalog && catalog.modelsById) || {};
    var models = lists[id] || (builtin ? lists[builtin.catalogId] : null) || (id === "google-gemini" ? lists.google : null) || [];
    var rows = models.map(function (model) {
      return { value: model.value, label: model.label };
    });
    var custom = null;
    (customProviders || []).forEach(function (entry) {
      if (entry && (entry.value || entry.id) === id) custom = entry;
    });
    if (custom && custom.label) rows.push({ value: "__custom__", label: String(custom.label) });
    return rows;
  }

  function reasoningForProvider(catalog, providerId, modelId) {
    var id = String(providerId || "");
    var builtin = builtinProvider(id);
    var byProvider = (catalog && catalog.reasoning) || {};
    var models = byProvider[id] || (builtin ? byProvider[builtin.catalogId] : null) || {};
    return models[String(modelId || "")] || [];
  }

  /** R3. Picking a provider fills the endpoint with that provider's API base, unless the user
   *  has typed their own endpoint or the field holds a different provider's value. */
  function resolveEndpointOnProviderChange(current, previousProvider, nextProvider, providers) {
    var rows = providers || [];
    var next = null;
    var previous = null;
    rows.forEach(function (row) {
      if (!row) return;
      if (row.value === nextProvider) next = row;
      if (row.value === previousProvider) previous = row;
    });
    var nextApi = normalizeApi(next && next.api);
    var currentValue = String(current === undefined || current === null ? "" : current).trim();
    var previousApi = normalizeApi(previous && previous.api);
    var untouched =
      !currentValue ||
      (previousApi && normalizeApi(currentValue) === previousApi) ||
      (nextApi && normalizeEndpointSafely(currentValue) === nextApi);
    if (untouched) return nextApi;
    return currentValue;
  }

  function normalizeEndpointSafely(value) {
    try {
      return normalizeEndpoint(value);
    } catch (error) {
      return String(value || "").trim();
    }
  }

  /** R1. Human-readable language rows, alphabetical by label, with the stored value kept. */
  function languageOptions(names, current) {
    var source = names && typeof names === "object" ? names : {};
    var rows = Object.keys(source)
      .filter(function (code) {
        // "auto" is a source-language concept; a target picker must not offer it.
        return code && source[code] && !/^auto$/i.test(code);
      })
      .map(function (code) {
        return { value: code, label: String(source[code]) + " (" + code + ")" };
      })
      .sort(byLabel);
    var selected = String(current || "").trim();
    var found = rows.some(function (row) { return row.value === selected; });
    if (selected && !found) {
      rows.push({ value: selected, label: selected });
      rows.sort(byLabel);
    }
    return rows;
  }

  /** Panel rows for every provider: model lists + reasoning levels, one call, no I/O. */
  function buildPanelCatalogue(catalog, settings, customProviders) {
    settings = settings || {};
    var providers = buildProviderList(catalog, customProviders);
    var modelsByProvider = {};
    var reasoningByProvider = {};
    providers.forEach(function (row) {
      var models = modelsForProvider(catalog, row.value, customProviders);
      modelsByProvider[row.value] = models;
      var levels = {};
      models.forEach(function (model) {
        if (model.value === "__custom__") return;
        var declared = reasoningForProvider(catalog, row.value, model.value);
        if (declared.length) levels[model.value] = declared;
      });
      reasoningByProvider[row.value] = levels;
    });
    return {
      providers: providers,
      modelsByProvider: modelsByProvider,
      reasoningByProvider: reasoningByProvider,
      models: modelsByProvider[settings.provider] || [],
      reasoning: reasoningLevels(settings.reasoning, (reasoningByProvider[settings.provider] || {})[settings.model] || []),
    };
  }

  /** The engine/locale-independent shape of one panel render, used by Code.gs and the tests. */
  function buildPanelModel(settings, panel) {
    settings = settings || {};
    var catalog = panel.catalog || { providers: [], modelsById: {}, reasoning: {} };
    var providers = buildProviderList(catalog, panel.customProviders);
    // SPEC 2.1: no provider means no provider — an unconfigured panel must not silently adopt
    // the first row of the catalogue as its selection.
    var providerId = settings.provider || panel.defaultProvider || "";
    var models = providerId ? modelsForProvider(catalog, providerId, panel.customProviders) : [];
    var modelId = settings.model || panel.defaultModel || (models[0] && models[0].value) || "";
    var levels = reasoningForProvider(catalog, providerId, modelId);
    return {
      providers: providers,
      modelsByProvider: { [providerId]: models },
      reasoning: reasoningLevels(settings.reasoning, levels),
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
    LOWEST: LOWEST,
    BUILTIN_PROVIDERS: BUILTIN_PROVIDERS,
    PROVIDER_ALIASES: PROVIDER_ALIASES,
    normalizeEndpoint: normalizeEndpoint,
    chatCompletionsUrl: chatCompletionsUrl,
    buildChatPayload: buildChatPayload,
    parseChatResponse: parseChatResponse,
    googleUrl: googleUrl,
    parseGoogleResponse: parseGoogleResponse,
    chunkText: chunkText,
    projectCatalog: projectCatalog,
    buildProviderList: buildProviderList,
    modelsForProvider: modelsForProvider,
    reasoningForProvider: reasoningForProvider,
    reasoningLevels: reasoningLevels,
    reasoningLevelsFor: declaredReasoningLevels,
    buildPanelCatalogue: buildPanelCatalogue,
    buildPanelModel: buildPanelModel,
    resolveEndpointOnProviderChange: resolveEndpointOnProviderChange,
    resolveReasoningDepth: resolveReasoningDepth,
    languageOptions: languageOptions,
  };

  root.DualTranCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
