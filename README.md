# DualTran Translate for Google Docs

Select paragraphs, translate them, and keep the original: the translation is inserted as a new
paragraph directly below the source, in a muted colour.

- **Google Translate** — no key, no configuration
- **AI** — any OpenAI-compatible endpoint with your own key (OpenAI, DeepSeek, OpenRouter…)

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

- 7 unit tests over the translation core (`npm test`), plus `node --check` on both script files.
- **Not yet run inside Google Docs** — Apps Script has no local runtime here, and publishing to
  the Workspace Marketplace needs a Cloud project plus OAuth verification.

## Licence

MPL-2.0.
