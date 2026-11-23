/**
 * Word meanings for "select a word" on the site.
 *
 * During Pre-translate, every block of text gets a list of its content words and fixed
 * phrases, and for each language: the matching words in that language's translation,
 * what the word means in this sentence, and its dictionary meanings. Saved like the
 * translations (translations/words-<lang>.json) and published as t/words/<lang>.json,
 * so visitors look words up for free.
 */
import { createHash } from "node:crypto";
import type { StructuredCall } from "./model.js";
import { getLanguage, type Language } from "./languages.js";
import { EVERYDAY_NOTES } from "./prompts.js";
import type { Voice } from "./types.js";

export interface WordGloss {
  /** The word or phrase as written in the original text. */
  s: string;
  /** The words carrying that meaning in this language's version of the text ("" if none). */
  t: string;
  /** What it means in this sentence, in this language. */
  c: string;
  /** Common dictionary meanings, in this language. */
  d: string;
}

/** Store "language" for a language's word meanings (file translations/words-<lang>.json). */
export const wordsStoreKey = (lang: string) => `words-${lang}`;

/** Changes when the text the words were read from changes, so meanings are redone with it. */
export function wordsSettings(shownText: string): string {
  return "words-v1:" + createHash("sha256").update(shownText.trim()).digest("hex").slice(0, 12);
}

export const plain = (s: string) => s.replace(/⟦\d+⟧/g, "").replace(/\s+/g, " ").trim();

export const WORDS_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          words: {
            type: "array",
            items: {
              type: "object",
              properties: {
                s: { type: "string", description: "Word or phrase copied exactly from the original." },
                t: { type: "string", description: "Matching words copied exactly from the version in the target language, or empty." },
                c: { type: "string", description: "Meaning in this sentence, in the target language." },
                d: { type: "string", description: "Dictionary meanings in the target language, most common first." },
              },
              required: ["s", "t", "c", "d"],
            },
          },
        },
        required: ["id", "words"],
      },
    },
  },
  required: ["results"],
} as const;

export interface WordSegment {
  id: string;
  /** Original text (may contain ⟦n⟧ markers; they are removed before sending). */
  source: string;
  /** How the text reads in the target language (the source itself when it's already in it). */
  shown: string;
}

export function wordsSystem(target: Language, voice?: Voice): string {
  const everyday = voice === "everyday" && EVERYDAY_NOTES[target.code] ? `\n\nUse the words people actually say today.\n${EVERYDAY_NOTES[target.code]}` : "";
  return `You prepare word lookups for a website. A reader selects a word and sees what it means, in ${target.name} (${target.nativeName}).

For each segment you get the ORIGINAL text and the same text as it reads in ${target.name}.
List the content words and fixed phrases of the ORIGINAL: nouns, verbs, adjectives, adverbs, idioms and phrasal verbs ("gone quiet", "bad day", "look after"). Skip articles, pronouns, prepositions, conjunctions, auxiliary verbs, numbers, URLs and names of people or brands. A fixed phrase is one item; don't also list its words separately.

For each item:
- s: copied EXACTLY from the original, same spelling and case.
- t: the words in the ${target.name} version that carry this meaning, copied EXACTLY from it; "" if no words there match.
- c: what it means IN THIS SENTENCE, in ${target.name}: 1 to 6 everyday words. Context decides ("my work lives where…" means "is found", not "is alive").
- d: its common dictionary meanings in ${target.name}: up to 3 short senses separated by ", ", most common first.
If the original is already in ${target.name}: t = s, c = a short plain explanation of its meaning here, d = plain dictionary senses.

Return one result for EVERY segment id, in order.${everyday}`;
}

export function wordsUser(target: Language, segments: WordSegment[]): string {
  const items = segments.map((s) => ({ id: s.id, original: plain(s.source), [target.code]: plain(s.shown) }));
  return `Word lookups in ${target.name} (${target.code}).\n<segments>\n${JSON.stringify(items, null, 1)}\n</segments>`;
}

export function wordsCall(lang: string, segments: WordSegment[], voice?: Voice): StructuredCall {
  const target = getLanguage(lang);
  if (!target) throw new Error(`Unsupported language: ${lang}`);
  return {
    system: wordsSystem(target, voice),
    user: wordsUser(target, segments),
    toolName: "submit_words",
    toolDescription: "Submit the word lookups for every segment.",
    schema: WORDS_SCHEMA,
    maxTokens: 16000,
  };
}

/** Groups segments into requests of about `maxChars` of original text. */
export function chunkWordSegments<S extends WordSegment>(segs: S[], maxChars = 1500): S[][] {
  const out: S[][] = [];
  let cur: S[] = [];
  let n = 0;
  for (const s of segs) {
    const len = plain(s.source).length;
    if (cur.length && n + len > maxChars) {
      out.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(s);
    n += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

const norm = (s: string) => s.toLocaleLowerCase().normalize("NFC");

/** Keeps only lookups that really point into the texts, without duplicates. */
export function cleanGlosses(raw: Array<Partial<WordGloss>> | undefined, source: string, shown: string): WordGloss[] {
  const src = norm(plain(source));
  const tgt = norm(plain(shown));
  const seen = new Set<string>();
  const out: WordGloss[] = [];
  for (const r of raw ?? []) {
    const s = (r.s ?? "").trim();
    const c = (r.c ?? "").trim();
    const d = (r.d ?? "").trim();
    if (!s || (!c && !d) || !src.includes(norm(s)) || seen.has(norm(s))) continue;
    let t = (r.t ?? "").trim();
    if (t && !tgt.includes(norm(t))) t = "";
    seen.add(norm(s));
    out.push({ s, t, c, d });
    if (out.length >= 80) break;
  }
  return out;
}
