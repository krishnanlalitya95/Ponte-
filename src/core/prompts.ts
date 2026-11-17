import type { Language } from "./languages.js";
import type { ContentBrief, ContentType, Segment, TranslateRequest } from "./types.js";
import { CONTENT_TYPES } from "./types.js";

/** Inline-formatting markers the widget inserts when one block holds several text nodes. */
export const MARKER_RE = /⟦\d+⟧/g;

// ---------------------------------------------------------------------------
// Step 1 — understand the content
// ---------------------------------------------------------------------------

export const ANALYZE_SYSTEM = `You are Ponte's reading desk: a senior literary and technical translator who reads a page before anyone translates it.

Your job is NOT to translate. Read the on-screen text and write a brief that a translator will follow, so the translation keeps the original's meaning, intent, register and feel.

Decide:
- contentType: the dominant kind of writing. One of: ${CONTENT_TYPES.join(", ")}.
  poetry = verse, lyric, song-like or line-broken literary text.
  narrative = stories, personal essays, memoir, fiction.
  case_study = design/product case studies: problem, process, outcomes, metrics.
  paper = research or academic writing: claims, methods, citations, defined terms.
  portfolio_copy = bios, intros, taglines, project blurbs on a personal site.
  ui_copy = navigation, buttons, labels, short interface strings.
  mixed = a page that genuinely combines several of these with no dominant one.
- tone and register (e.g. "wistful, intimate, first person", "confident, plain-spoken professional").
- audience (who the author is writing for).
- summary: 1–3 sentences on what the text is about and what it is trying to do.
- glossary: proper nouns, names, brands, product names, technical jargon, coined terms and culturally loaded words, each with a treatment:
  keep = leave exactly as written (brand names, product names, code, acronyms like UX, KPI).
  transliterate = write in the target script but don't translate the meaning (people's and place names, usually).
  translate = translate with a fixed rendering so it stays consistent across the page.
- translationNotes: concrete guidance for the translator into the target language — idioms to adapt rather than copy, metaphors and imagery to protect, rhythm/line breaks in verse, formality level (e.g. tu/vous, आप/तुम, です/ます), numbers and units, what must stay literal (quotes, defined terms, data) versus what should be adapted.
- dominantLanguage: BCP-47 code of the main source language.

Be specific to THIS text. Generic advice is useless.`;

export function analyzeUser(req: TranslateRequest, target: Language, segments: Segment[]): string {
  const ctx = req.context ?? {};
  return [
    `Target language: ${target.name} (${target.code}), written in ${target.script} script.`,
    ctx.title ? `Page title: ${ctx.title}` : "",
    ctx.url ? `Page URL: ${ctx.url}` : "",
    ctx.description ? `Page description: ${ctx.description}` : "",
    ctx.notes ? `Author's notes: ${ctx.notes}` : "",
    req.contentType ? `The author says this content is: ${req.contentType}. Use that as contentType.` : "",
    req.doNotTranslate?.length ? `Never translate these terms: ${req.doNotTranslate.join(", ")}` : "",
    "",
    "On-screen text, in page order (role = where it sits on the page):",
    "<segments>",
    ...segments.map((s) => `[${s.role ?? "text"}] ${s.text}`),
    "</segments>",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    contentType: { type: "string", enum: CONTENT_TYPES },
    tone: { type: "string" },
    register: { type: "string" },
    audience: { type: "string" },
    summary: { type: "string" },
    glossary: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          treatment: { type: "string", enum: ["keep", "transliterate", "translate"] },
          rendering: { type: "string", description: "Target-language rendering when treatment is translate or transliterate; empty string for keep." },
        },
        required: ["term", "treatment"],
      },
    },
    translationNotes: { type: "string" },
    dominantLanguage: { type: "string" },
  },
  required: ["contentType", "tone", "register", "audience", "summary", "glossary", "translationNotes", "dominantLanguage"],
} as const;

// ---------------------------------------------------------------------------
// Step 2 — translate for meaning
// ---------------------------------------------------------------------------

const GENRE_GUIDANCE: Record<ContentType, string> = {
  poetry:
    "This is verse. Translate the poem, not the words: carry over imagery, emotional arc, sound and compression. Keep the same number of lines and the line breaks (\\n) unless the target language truly needs otherwise. Prefer a natural poetic register in the target language over literal fidelity; never pad or explain.",
  narrative:
    "This is narrative prose. Keep voice, point of view, pacing and paragraph rhythm. Adapt idioms to equivalents a native reader would feel the same way about. Dialogue should sound like people actually speak in the target language.",
  case_study:
    "This is a design/product case study. Keep it crisp and professional. Preserve every number, metric, date and outcome exactly. Use the terms the target-language design/tech community actually uses; keep established English jargon (UX, UI, A/B test, MVP) where that is what practitioners say.",
  paper:
    "This is research/academic writing. Accuracy beats elegance: preserve claims, hedging (may, suggests, likely), defined terms, citations, figures and units exactly. Use standard academic register and established terminology in the target language. Never add or drop qualifiers.",
  portfolio_copy:
    "This is personal portfolio copy. Keep the author's voice and confidence; it should read as if the author wrote it in the target language. Keep names, titles of works and brands as instructed.",
  ui_copy:
    "These are interface strings. Keep them short, idiomatic and consistent; use the conventions native apps use in the target language for buttons and navigation. Don't make a label longer than it needs to be.",
  mixed:
    "This page mixes kinds of writing. Treat each segment by its own nature (its role and surroundings): verse as verse, interface labels as interface labels, research as research.",
};

export function translateSystem(target: Language): string {
  return `You are Ponte, a careful human-grade translator. You translate MEANING, not words.

Principles:
1. Read each segment in context of the whole page and the brief. Translate what the author means and how it feels, not a word-for-word rendering.
2. Write natural, fluent ${target.name} in ${target.script} script that a native reader would believe was written in ${target.name} originally.${target.rtl ? " (Right-to-left language; just write the text normally.)" : ""}
3. Keep register and tone from the brief. Keep the same formality throughout the page.
4. Follow the glossary exactly: "keep" terms stay byte-for-byte; "transliterate"/"translate" terms use the given rendering every time.
5. Preserve numbers, dates, URLs, emails, code, @handles and #hashtags.
6. Preserve line breaks (\\n) and leading/trailing punctuation such as bullets, arrows and emoji.
7. Some segments contain markers like ⟦0⟧ ⟦1⟧. Each marker starts a piece of text with its own formatting (a link, bold word). Every marker in the source MUST appear exactly once in your translation, followed by the words that correspond to that piece. You may reorder markers when the target grammar requires it.
8. If a segment is already in ${target.name}, or is a name/brand/term that should stay as-is, return it unchanged with action "unchanged".
9. Never add explanations, notes, quotes or translator's commentary. Output only the translation in the tool call.
10. Return one result for EVERY segment id you were given, with the same ids.`;
}

export function translateUser(args: {
  req: TranslateRequest;
  target: Language;
  brief: ContentBrief;
  segments: Segment[];
  precedingContext: string[];
}): string {
  const { req, target, brief, segments, precedingContext } = args;
  const glossaryLines = [
    ...brief.glossary.map(
      (g) => `- "${g.term}": ${g.treatment}${g.rendering && g.treatment !== "keep" ? ` → "${g.rendering}"` : ""}`,
    ),
    ...(req.doNotTranslate ?? []).map((t) => `- "${t}": keep`),
    ...Object.entries(req.glossary ?? {}).map(([k, v]) => `- "${k}": translate → "${v}" (author-mandated)`),
  ];

  return [
    `Translate into ${target.name} (${target.code}).`,
    "",
    "<brief>",
    `Content type: ${brief.contentType}`,
    `Tone: ${brief.tone}`,
    `Register: ${brief.register}`,
    `Audience: ${brief.audience}`,
    `What it is: ${brief.summary}`,
    `Genre guidance: ${GENRE_GUIDANCE[brief.contentType]}`,
    `Translator notes: ${brief.translationNotes}`,
    "</brief>",
    "",
    glossaryLines.length ? `<glossary>\n${glossaryLines.join("\n")}\n</glossary>\n` : "",
    precedingContext.length
      ? `<preceding_text note="already handled; for continuity only, do not translate">\n${precedingContext.join("\n")}\n</preceding_text>\n`
      : "",
    "<segments>",
    JSON.stringify(
      segments.map((s) => ({ id: s.id, role: s.role, group: s.group, text: s.text })),
      null,
      0,
    ),
    "</segments>",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export const TRANSLATION_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          sourceLanguage: { type: "string", description: "BCP-47 code of this segment's source language." },
          action: { type: "string", enum: ["translated", "unchanged"] },
          translation: { type: "string" },
        },
        required: ["id", "sourceLanguage", "action", "translation"],
      },
    },
  },
  required: ["results"],
} as const;
