import type { Language } from "./languages.js";
import type { ContentBrief, ContentType, Segment, TranslateRequest, Voice } from "./types.js";
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
- glossary (at most 30 entries; the ones that matter most for consistency): proper nouns, names, brands, product names, technical jargon, coined terms and culturally loaded words, each with a treatment:
  keep = leave exactly as written (brand names, product names, code, acronyms like UX, KPI).
  transliterate = write in the target language's script but don't translate the meaning (people's and place names, usually).
  translate = translate consistently across the page.
  Leave "rendering" empty: each translator chooses the rendering in their own language.
- translationNotes: concrete guidance that holds for translating into ANY language (this brief is shared by translators into Indian, European and East Asian languages) — idioms to adapt rather than copy, metaphors and imagery to protect, rhythm/line breaks in verse, the level of formality and warmth to aim for, numbers and units, what must stay literal (quotes, defined terms, data) versus what should be adapted.
- dominantLanguage: BCP-47 code of the main source language.

Be specific to THIS text. Generic advice is useless.`;

export function analyzeUser(req: TranslateRequest, segments: Segment[]): string {
  const ctx = req.context ?? {};
  return [
    "This brief will be shared by translators into many languages.",
    ctx.title ? `Page title: ${ctx.title}` : "",
    ctx.url ? `Page URL: ${ctx.url}` : "",
    ctx.description ? `Page description: ${ctx.description}` : "",
    ctx.notes ? `Author's notes: ${ctx.notes}` : "",
    req.contentType ? `The author says this content is: ${req.contentType}. Use that as contentType.` : "",
    authorLine(req),
    req.voice ? `Voice the author wants in every language: ${VOICE_LABEL[req.voice]}. Describe register and write translationNotes with that in mind.` : "",
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
// Voice — how everyday the language should sound
// ---------------------------------------------------------------------------

const VOICE_LABEL: Record<Voice, string> = {
  everyday: "everyday — the words people actually use when they talk and text today, never textbook or official language",
  standard: "standard written language",
  formal: "formal and polished",
};

const VOICE_GUIDANCE: Record<Voice, string> = {
  everyday: `VOICE: EVERYDAY. This matters more than sounding elegant.
Write the way an educated native speaker actually talks and writes today: to a friend or colleague on WhatsApp, in a well-made modern app, in a popular magazine. NOT the way a textbook, a government notice, a dictionary or a literary classic does.
- Common word over "pure", literary or Sanskritised/classical word. If two words mean the same thing, pick the one people say.
- If people normally say the English word (design, app, user, project, team, feedback, research, prototype, website, office…), write that English word in the target script. Don't invent or dig up a native coinage nobody uses.
- Translate the meaning of each sentence, then say it the natural way. Rebuild the sentence if needed; short, simple sentences beat long formal ones.
- Idioms and phrasal expressions: use what a native speaker would say in that moment, not the dictionary equivalent.
- Still respectful and correct — everyday, not slangy, not crude, no text-speak.
- Verse stays poetic: keep the imagery and music, but with words that feel alive today, not archaic or bookish ones.
- Numbers, metrics, research claims and hedging stay exact — only the wording gets simpler.
- Before you submit, re-read each line and ask: "Would a 25-year-old who speaks this language at home actually say this?" If not, change the word or the sentence.`,
  standard: "VOICE: STANDARD. Neutral, clear written language; avoid both slang and archaic or bureaucratic words.",
  formal: "VOICE: FORMAL. Polished, respectful written register suitable for official or academic readers.",
};

/** What "everyday" means in each language — where models most often drift into textbook register. */
const EVERYDAY_NOTES: Record<string, string> = {
  hi: `Hindi: write spoken Hindustani as people in Mumbai/Delhi actually use it, not शुद्ध/सरकारी हिंदी. Prefer काम (not कार्य), मदद (not सहायता), ज़रूरी (not आवश्यक), शुरू (not प्रारंभ), इस्तेमाल (not उपयोग/प्रयोग), लोग (not व्यक्ति/जन), सोच/आइडिया (not विचारधारा), बेहतर (not उत्कृष्ट), आसान (not सरल/सुगम). Urdu-origin everyday words (ज़िंदगी, शौक़, ख़ास, दुनिया, वक़्त) are natural. Use English loanwords people say: डिज़ाइन, यूज़र, ऐप, प्रोजेक्ट, टीम, रिसर्च, फ़ीडबैक — never coinages like प्रयोक्ता, अनुप्रयोग, अभिकल्पना, अभिकल्पक.`,
  mr: `Marathi: everyday spoken-standard Marathi (as in Pune/Mumbai), not heavy Sanskritised or official Marathi. Use English loanwords people say: डिझाइन, युझर, ॲप, प्रोजेक्ट, टीम, रिसर्च. Prefer वापर (not उपयोजन), काम, मदत, गरज.`,
  gu: `Gujarati: everyday Gujarati as spoken in Ahmedabad/Mumbai, not literary or official. Keep English loanwords people use: ડિઝાઇન, યુઝર, એપ, પ્રોજેક્ટ, ટીમ.`,
  bn: `Bengali: চলিত ভাষা (modern colloquial standard), never সাধু ভাষা forms (করিয়া, তাহার, ইহা). Everyday words over tatsama-heavy ones (কাজ not কার্য, সাহায্য/হেল্প as people say). Keep English loanwords Kolkata speakers use: ডিজাইন, ইউজার, অ্যাপ, প্রজেক্ট, টিম.`,
  ta: `Tamil: simple modern written Tamil as used by popular Tamil websites and apps — not literary செந்தமிழ், and don't use தனித்தமிழ் coinages for tech or work words. Keep English loanwords Tamil speakers actually use: டிசைன், யூசர், ஆப், ப்ராஜெக்ட், டீம், ரிசர்ச். Don't write spoken-dialect spellings (e.g. பண்றேன்) either — modern written form, everyday vocabulary.`,
  te: `Telugu: వ్యావహారిక భాష (modern spoken standard), never గ్రాంథిక forms. Keep English loanwords people use: డిజైన్, యూజర్, యాప్, ప్రాజెక్ట్, టీమ్.`,
  kn: `Kannada: everyday modern Kannada as used in Bengaluru, not heavy Sanskritised or official Kannada. Keep English loanwords people use: ಡಿಸೈನ್, ಯೂಸರ್, ಆ್ಯಪ್, ಪ್ರಾಜೆಕ್ಟ್, ಟೀಮ್.`,
  ml: `Malayalam: simple modern written Malayalam as in popular news/lifestyle sites, not heavy Sanskritised literary style. Keep English loanwords people use: ഡിസൈൻ, യൂസർ, ആപ്പ്, പ്രോജക്ട്, ടീം.`,
  pa: `Punjabi: everyday Punjabi as spoken, with English loanwords people use (ਡਿਜ਼ਾਈਨ, ਯੂਜ਼ਰ, ਐਪ, ਪ੍ਰੋਜੈਕਟ).`,
  or: `Odia: everyday modern Odia, with English loanwords people use (ଡିଜାଇନ, ୟୁଜର, ଆପ୍).`,
  ur: `Urdu: everyday spoken Urdu, not heavy Persianised/Arabic literary vocabulary; English loanwords people use (ڈیزائن، یوزر، ایپ، پروجیکٹ).`,
  fr: `French: natural contemporary French as on a good modern website — light, direct, not administrative (avoid "afin de", "ledit", nominal chains). Anglicisms that French designers actually use (design, UX, feedback) are fine.`,
  de: `German: natural contemporary German as modern design studios write it — short sentences, verbs over noun chains (avoid Behördendeutsch and stacked compounds). Established anglicisms (Design, User, Feedback, Team) are fine.`,
  es: `Spanish: natural, contemporary, neutral Spanish; direct and warm, not bureaucratic.`,
  pt: `Portuguese: natural contemporary Portuguese; direct, not bureaucratic.`,
  it: `Italian: natural contemporary Italian; avoid burocratese.`,
  ar: `Arabic: clear, simple Modern Standard Arabic as used by modern tech and lifestyle sites — not classical or ornate. Short sentences; familiar vocabulary; established loanwords (تطبيق، تصميم) are fine.`,
  ja: `Japanese: plain, friendly です・ます style; avoid stiff 漢語-heavy phrasing and over-honorific keigo (尊敬語/謙譲語 piles). Use katakana loanwords Japanese designers use: デザイン, ユーザー, アプリ, プロジェクト, チーム, リサーチ.`,
  ko: `Korean: friendly 해요체, not stiff 합니다체 throughout; prefer everyday words over heavy Sino-Korean ones. Use loanwords Korean designers use: 디자인, 사용자/유저, 앱, 프로젝트, 팀, 리서치.`,
  zh: `Chinese: natural modern Mandarin as on popular apps and sites; avoid 书面语/四字成语 piles and bureaucratic phrasing.`,
  ru: `Russian: natural contemporary Russian; avoid канцелярит (officialese, noun chains).`,
  id: `Indonesian: everyday Bahasa Indonesia as on modern apps, not stiff formal government style; common English loanwords are fine.`,
  tr: `Turkish: natural contemporary Turkish; avoid stiff Ottoman-era or bureaucratic vocabulary.`,
  nl: `Dutch: natural, direct contemporary Dutch; avoid ambtelijke taal.`,
  en: `English: plain, natural, contemporary English; avoid stiff or archaic phrasing.`,
};

function voiceSection(target: Language, voice: Voice | undefined): string {
  if (!voice) return "";
  const lang = voice === "everyday" && EVERYDAY_NOTES[target.code] ? `\n${EVERYDAY_NOTES[target.code]}` : "";
  return `\n\n${VOICE_GUIDANCE[voice]}${lang}`;
}

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

const GENDER_FORMS: Record<string, string> = {
  male: "masculine",
  female: "feminine",
  neutral: "gender-neutral where the language allows (otherwise the most natural unmarked form)",
};

/** Tells the model who "I" is, so verb and adjective agreement is right in gendered languages. */
export function authorLine(req: TranslateRequest): string {
  const a = req.author;
  if (!a || (!a.name && !a.gender && !a.notes)) return "";
  const parts: string[] = [];
  if (a.name) parts.push(`The author is ${a.name}.`);
  if (a.gender && GENDER_FORMS[a.gender]) {
    parts.push(
      `Whenever the text speaks in the first person (I, me, my, we in a personal sense), the author is ${a.gender}: use ${GENDER_FORMS[a.gender]} first-person forms in every language that marks gender ` +
        `(e.g. Hindi/Marathi/Punjabi/Gujarati/Urdu verb endings such as "${a.gender === "female" ? "करती हूँ" : "करता हूँ"}", Spanish/French/Portuguese/Italian adjectives and participles, Arabic). ` +
        `This applies only to the author; keep other people's gender as written.`,
    );
  }
  if (a.notes) parts.push(`About the author: ${a.notes}`);
  return `Author: ${parts.join(" ")}`;
}

export function translateSystem(target: Language, voice?: Voice): string {
  return `You are Ponte, a careful human-grade translator. You translate MEANING, not words.

Principles:
1. Read each segment in context of the whole page and the brief. Translate what the author means and how it feels, not a word-for-word rendering.
2. Write natural, fluent ${target.name} in ${target.script} script that a native reader would believe was written in ${target.name} originally.${target.rtl ? " (Right-to-left language; just write the text normally.)" : ""}
3. Keep register and tone from the brief. Keep the same formality throughout the page. A translation is wrong if it is accurate but sounds like nobody talks that way.
4. Follow the glossary exactly: "keep" terms stay byte-for-byte; "transliterate"/"translate" terms use the given rendering every time.
5. Preserve numbers, dates, URLs, emails, code, @handles and #hashtags.
6. Preserve line breaks (\\n) and leading/trailing punctuation such as bullets, arrows and emoji.
7. Some segments contain markers like ⟦0⟧ ⟦1⟧. Each marker starts a piece of text with its own formatting (a link, bold word). Every marker in the source MUST appear exactly once in your translation, followed by the words that correspond to that piece. You may reorder markers when the target grammar requires it.
8. If a segment is already in ${target.name}, or is a name/brand/term that should stay as-is, return it unchanged with action "unchanged".
9. Never add explanations, notes, quotes or translator's commentary. Output only the translation in the tool call.
10. Return one result for EVERY segment id you were given, with the same ids.${voiceSection(target, voice)}`;
}

/** When the target is the page's own language, everything sent is in some other language. */
function intoPageLanguageNote(req: TranslateRequest, target: Language): string {
  if (!req.sourceLanguage || req.sourceLanguage.split("-")[0] !== target.code) return "";
  return `Note: the page is written in ${target.name}; these segments are the parts written in another language (for example poems). Translate every one of them into ${target.name}, line by line where the original is in lines, keeping the poetry. Do not mark any of them "unchanged".`;
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
    intoPageLanguageNote(req, target),
    "",
    "<brief>",
    `Content type: ${brief.contentType}`,
    `Tone: ${brief.tone}`,
    `Register: ${brief.register}`,
    `Audience: ${brief.audience}`,
    `What it is: ${brief.summary}`,
    `Genre guidance: ${GENRE_GUIDANCE[brief.contentType]}`,
    `Translator notes: ${brief.translationNotes}`,
    authorLine(req),
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
