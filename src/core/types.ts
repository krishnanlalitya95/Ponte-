export type ContentType =
  | "poetry"
  | "narrative"
  | "case_study"
  | "paper"
  | "portfolio_copy"
  | "ui_copy"
  | "mixed";

export const CONTENT_TYPES: ContentType[] = [
  "poetry",
  "narrative",
  "case_study",
  "paper",
  "portfolio_copy",
  "ui_copy",
  "mixed",
];

/**
 * How everyday the language should sound.
 * everyday = the words people actually use when they talk and text today (default for GlossAI).
 * standard = neutral written language.
 * formal   = polished, official register.
 */
export type Voice = "everyday" | "standard" | "formal";

/** Who wrote the text, so first-person grammar (gendered verbs/adjectives) comes out right. */
export interface Author {
  name?: string;
  /** Grammatical gender for first-person forms in languages that mark it. */
  gender?: "male" | "female" | "neutral";
  /** Anything else the translator should know about the author's voice. */
  notes?: string;
}

/** One piece of plain text found on screen. `id` is opaque to Ponte and echoed back. */
export interface Segment {
  id: string;
  text: string;
  /** Optional hint about where the text sits: "h1", "nav", "button", "p", "caption"… */
  role?: string;
  /** Optional grouping key (e.g. section id) so related segments are translated together. */
  group?: string;
}

export interface TranslateRequest {
  segments: Segment[];
  targetLanguage: string;
  /** If known; otherwise Ponte detects it per segment. */
  sourceLanguage?: string;
  /** Force a content type instead of letting the agent infer it. */
  contentType?: ContentType;
  /** Page-level context: title, URL, a short description. Helps the agent read intent. */
  context?: { title?: string; url?: string; description?: string; notes?: string };
  /** Terms that must never be translated (names, product names). */
  doNotTranslate?: string[];
  /** Fixed renderings, e.g. { "case study": "केस स्टडी" }. */
  glossary?: Record<string, string>;
  /** The author of the text (first-person voice). */
  author?: Author;
  /** How everyday the language should sound. Unset = standard. */
  voice?: Voice;
}

export interface GlossaryEntry {
  term: string;
  /** "keep" = leave as-is, "transliterate" = write in target script, "translate" = use rendering. */
  treatment: "keep" | "transliterate" | "translate";
  rendering?: string;
}

/** What the agent understood about the content before translating. */
export interface ContentBrief {
  contentType: ContentType;
  tone: string;
  register: string;
  audience: string;
  summary: string;
  glossary: GlossaryEntry[];
  translationNotes: string;
  /** Dominant source language across all segments. */
  dominantLanguage: string;
}

export type SegmentStatus = "translated" | "unchanged" | "skipped" | "fallback";

export interface SegmentResult {
  id: string;
  /** Replacement text. Equal to the original when status !== "translated". */
  text: string;
  sourceLanguage: string;
  status: SegmentStatus;
  /** Why it wasn't translated, when applicable. */
  reason?: string;
  /** True when served from saved translations (no agent call). */
  saved?: boolean;
}

export interface TranslateResponse {
  targetLanguage: string;
  /** The agent's reading of the page; null when everything came from saved translations. */
  brief: ContentBrief | null;
  results: SegmentResult[];
  usage: { inputTokens: number; outputTokens: number; storedSegments: number; modelCalls: number };
  model: string;
}
