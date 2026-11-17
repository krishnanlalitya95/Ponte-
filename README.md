# Ponte

**Agentic, meaning-first translation for Framer sites.** Ponte finds the plain text on screen, reads it like a translator (what kind of writing is this? what tone? which names stay as they are?), translates for meaning instead of word-for-word, and swaps the text **in place**. You get no side-by-side dump of machine translation.

It's built for portfolios that mix short UI copy with long-form work: poetry, stories, case studies and papers. It covers major Indian languages (Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia, Urdu) and major global ones (English, Spanish, French, German, Portuguese, Italian, Japanese, Chinese, Korean, Arabic, Russian, Indonesian, Turkish, Dutch). Claude powers it.

```
 Framer page ──▶ Visitor widget / Code component
                     │  plain-text segments + page context
                     ▼
            POST /v1/channels/framer/translate
                     │
            ┌────────┴─────────────────────────────┐
            │ Ponte agent                          │
            │ 1. Detect   script hints, skip junk  │
            │ 2. Read     genre, tone, glossary    │  ← one Claude call per page
            │ 3. Translate meaning-first, chunked  │  ← Claude, structured output
            │ 4. Validate ids, markers, retry      │
            └────────┬─────────────────────────────┘
                     ▼
         { id → replacement text } ──▶ written back into the same DOM nodes
```

## Quick start

```bash
npm install
cp .env.example .env        # add ANTHROPIC_API_KEY
npm start                   # http://localhost:8787/demo
```

To try it without an API key, run `npm run mock`. Mock mode returns `[hi] Hello`-style pseudo-translations, so you can wire up Framer and check layouts for free.

Open **http://localhost:8787/demo** and pick a language from the pill in the bottom-right corner.

## Using it in Framer

### 1. Visitor widget (whole page, for visitors)

Use **either** option:

**A. Code component (recommended):** in Framer, go to **Assets → Code → New component**, paste [`framer/PonteWidget.tsx`](framer/PonteWidget.tsx), then drop it into your nav or footer. Set:
- **Endpoint**: your Ponte server (`http://localhost:8787` while developing)
- **Languages**: which languages to offer
- **Page language**: e.g. `en`
- **Keep as is**: names that must never change, e.g. `Lalitya Krishnan, CareOne, ICICI Lombard`

On the canvas the component only shows the picker. Translation runs in **Preview** and on the published site, so it never touches the editor itself.

**B. Script tag:** go to **Site Settings → General → Custom Code → End of `<body>` tag**:

```html
<script src="http://localhost:8787/widget.js"
        data-endpoint="http://localhost:8787"
        data-languages="hi,bn,ta,te,mr,en,es,fr,ja"
        data-source-language="en"
        data-do-not-translate="CareOne,ICICI Lombard"
        defer></script>
```

What the widget does:
- Walks the page's text nodes, skipping `script`, `style`, `code`, `pre`, form fields, and anything marked `data-ponte-skip`, `translate="no"` or `.notranslate`.
- Groups text into blocks. A paragraph with a link inside is sent as one sentence (`⟦0⟧Read the ⟦1⟧full write-up`), so it gets translated as a sentence. Each piece goes back into its own node, so links and bold text keep working.
- Sends the page title, URL and description along with the text, so Ponte understands what the page is.
- Remembers the visitor's choice. It also reads `?lang=hi` from the URL.
- Watches for re-renders (page transitions, variants, lazy sections) and translates new text too. Text it has already translated is re-applied instantly from cache.
- Sets `dir="rtl"` on blocks translated into Arabic or Urdu.
- Choosing **Original** restores the exact original text.

If you want an element to use a stable id across visits, give it `data-ponte-id="something"`. Otherwise ids are generated per page load.

### 2. Code component (author workflow)

[`framer/PonteText.tsx`](framer/PonteText.tsx) is a text component for long-form work. Paste the original into **Text**, choose a **Language**, and the translation renders right on the canvas, so you can review and style it while editing. Use **Content** to force a genre (for example **Poetry**) and **Notes** to give the translator context. Set **Language** to **Follow widget** to let visitors switch it with the visitor widget instead.

### Allowed origins

Browsers can only call Ponte from the origins listed in `PONTE_ALLOWED_ORIGINS`. The defaults cover `localhost`, `*.framer.app`, `*.framer.website` and the Framer canvas. Add your own domain, for example `https://lalityakrishnan.in`. If the widget says "Couldn't translate", check the server log for `Origin … is not allowed`.

## API

`POST /v1/channels/framer/translate`

```jsonc
{
  "targetLanguage": "hi",
  "sourceLanguage": "en",                 // optional
  "contentType": "poetry",                // optional; detected if omitted
  "context": { "title": "Monsoon letters", "url": "https://…", "notes": "written in 2019" },
  "doNotTranslate": ["CareOne"],
  "glossary": { "case study": "केस स्टडी" },
  "segments": [
    { "id": "poem-1", "text": "The rain came early this year,\nbefore the umbrellas,", "role": "p" }
  ]
}
```

The response includes the agent's reading of the page and one result per segment, in the same order:

```jsonc
{
  "targetLanguage": "hi",
  "brief": { "contentType": "poetry", "tone": "nostalgic, tender", "glossary": [...], "translationNotes": "...", ... },
  "results": [{ "id": "poem-1", "text": "…", "sourceLanguage": "en", "status": "translated" }],
  "usage": { "inputTokens": 1234, "outputTokens": 456, "cachedSegments": 0, "modelCalls": 2 },
  "model": "claude-sonnet-5-5"
}
```

`status` is one of these:
- `translated`
- `unchanged`: already in the target language, or a name that should stay
- `skipped`: numbers, URLs, symbols
- `fallback`: Ponte couldn't produce a valid translation, so the original is returned and the page never shows broken text

Other endpoints: `GET /v1/languages`, `GET /widget.js`, `GET /health`, `GET /demo`.

## How the agent works

1. **Detect.** A local Unicode-script pass skips text with nothing to translate (`2024`, URLs, emails) and text already in the target script. Claude also reports the source language of each segment.
2. **Read.** One Claude call reads the page and writes a brief: content type (poetry, narrative, case study, paper, portfolio copy, UI copy or mixed), tone, register, audience, a glossary (keep, transliterate or translate, with fixed renderings), and translator notes specific to the target language. Briefs are cached per page.
3. **Translate.** Claude translates in chunks, using the brief, genre-specific guidance and the end of the previous chunk for continuity. The prompt asks for meaning, idiom and feel. Poetry keeps its line breaks, papers keep their hedging and numbers, and UI copy stays short. Output is structured (a forced tool call), never parsed from free text.
4. **Validate.** Every id must come back, markers must be preserved, and the output must be non-empty and not runaway-long. Failures are retried once in smaller pieces, then fall back to the original.

Identical strings (nav items, repeated buttons) are translated once. Results are cached per segment, so repeat visitors cost nothing.

Model: `PONTE_MODEL` (default `claude-sonnet-5-5`). For the most literary nuance, use `claude-opus-5-5`.

## Evals

```bash
npm run eval              # all cases
npm run eval -- poetry    # filter by name
```

There are seven smoke cases: poetry (en→hi and hi→en), narrative (en→ta), case study (en→es), paper (en→bn), UI copy (en→ja) and portfolio copy (en→fr). Each one is checked in two ways:
- **Deterministically:** detected genre, kept names, numbers, verse line count, no fallbacks.
- **By a separate Claude judge** (`PONTE_JUDGE_MODEL`, default Opus): meaning, tone and fluency on a 1–5 scale, plus a word-for-word flag.

A case passes at ≥4 on all three scores with no word-for-word flag. Reports are written to `evals/reports/`.

### Running evals from GitHub (no computer needed)

1. On GitHub, open the repo → **Settings → Secrets and variables → Actions → New repository secret**. Name it `ANTHROPIC_API_KEY` and paste your key.
2. Open **Actions → Translation evals → Run workflow**. Optionally type a filter (for example `poetry`) and pick a model.
3. When the run finishes, open it. The full report, with scores, judge comments and side-by-side text, is shown on the run page.

Every push and pull request also runs the tests automatically (**Actions → CI**).

## Development

```bash
npm test                  # unit tests (agent, server, widget in jsdom) — no API key needed
npm run typecheck
npm run translate -- hi "Text to try"   # one-off translation in the terminal
```

```
src/core/      agent pipeline, prompts, language registry, model client, cache
src/server/    HTTP server (Framer channel API, CORS, limits, rate limiting)
widget/        browser engine + script-tag entry (built to dist/ponte-widget.js)
framer/        Framer code components: PonteWidget (visitors), PonteText (authoring)
evals/         smoke eval cases and runner
demo/          local demo page
test/          vitest suites
```

## v1 scope

These are out of scope for v1: rich-text structure beyond keeping inline links and bold in place, CMS sync, OCR of images or PDFs, sites outside Framer, and a hosted deploy. Development runs locally, and caches are in memory. A published Framer site needs the server reachable over HTTPS (a tunnel such as `cloudflared` or `ngrok` works for testing) and that origin added to `PONTE_ALLOWED_ORIGINS`.
