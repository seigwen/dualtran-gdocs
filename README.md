# DualTran Translate for Google Docs

Select paragraphs, translate them, and keep the original: the translation is inserted as a new
paragraph directly below the source, in a muted colour.

- **Google Translate** — no key, no configuration
- **AI** — your own key, for the providers listed in `appsscript.json` → `urlFetchWhitelist`
  (OpenAI, DeepSeek, OpenRouter, Anthropic, Moonshot, DashScope, BigModel, Groq, Gemini).
  Apps Script only allows `UrlFetchApp` calls to an explicit allow-list; to support another
  endpoint, add its `https://` prefix there and redeploy. Localhost endpoints cannot be reached
  from Apps Script because requests run on Google's servers, not in the browser.

Built as an Apps Script editor add-on, so it runs inside Docs with no server of ours.

## Install (unpublished, for testing)

```bash
npm i -g @google/clasp
clasp login
clasp create --type standalone --title "DualTran Translate" --rootDir .
clasp push
```

Then open the Apps Script editor → **Deploy → Test deployments → Install** and pick a document.
For a personal install, **Extensions → Apps Script** inside a Doc and paste the files works too.

## Use

1. Select one or more paragraphs in the document.
2. **DualTran → Open sidebar**, choose the engine and target language, save.
3. **Translate selection** — each translation lands under its source paragraph.

## Status

- 9 unit tests over the translation core and the Apps Script manifest (`npm test`), plus
  `node --check` on both script files.
- Code is pushed to Apps Script and a test deployment is installed, but the add-on sidebar
  has **not yet been exercised inside a Google Doc**; Marketplace submission is still pending.

## Licence

MPL-2.0.
