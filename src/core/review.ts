/**
 * The independent checker: after translating, a second pass reads each translation next to
 * the original and flags only real problems — wrong meaning, something missing or added, a
 * term or glossary entry handled wrongly, wrong grammar for the author, changed numbers or
 * names, words a native reader somewhere wouldn't understand — and returns a fixed version.
 *
 * Every checked translation is marked with a hash of its text (`checked`), so it is checked
 * once, and again only when its text changes. Hand-locked entries are never touched.
 */
import { createHash } from "node:crypto";
import type { StructuredCall } from "./model.js";
import { getLanguage, type Language } from "./languages.js";
import { authorLine, voiceSection } from "./prompts.js";
import { validateTranslation } from "./agent.js";
import type { TranslateRequest } from "./types.js";

export const checkMark = (text: string) => "check-v1:" + createHash("sha256").update(text.trim()).digest("hex").slice(0, 12);

export interface CheckSegment {
  id: string;
  source: string;
  translation: string;
}

export interface CheckResult {
  id: string;
  verdict: "ok" | "fix";
  problem?: string;
  fixed?: string;
}

export const CHECK_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["ok", "fix"] },
          problem: { type: "string", description: "What is wrong, in English, one short sentence. Empty when ok." },
          fixed: { type: "string", description: "The whole corrected translation. Empty when ok." },
        },
        required: ["id", "verdict"],
      },
    },
  },
  required: ["results"],
} as const;

export function checkSystem(target: Language, req: Pick<TranslateRequest, "author" | "voice" | "glossary" | "doNotTranslate">): string {
  const glossary = Object.entries(req.glossary ?? {});
  return `You are a senior ${target.name} reviewer checking a website's translations from English into ${target.name} (${target.nativeName}). The site has a global audience: native ${target.name} readers in every country where it is spoken.

For each segment, compare the translation with the original and flag ONLY real problems:
- the meaning is wrong, changed, weakened or exaggerated; something is missing or added
- a term is translated word by word instead of the name professionals use (e.g. Universal Design is a design field, not "worldwide design"), or a glossary entry below isn't followed exactly
- wrong grammar for the author (see below), or wrong person/number
- a number, date, name, link or ⟦n⟧ marker is changed, lost or duplicated
- words a native reader somewhere would not understand: needlessly literary, purist, archaic or bureaucratic words, regional slang, or English words where a common native word exists
- not in ${target.name}, or in the wrong script

Do NOT flag a translation just because you would phrase it differently. If it's correct and natural, verdict "ok".
When you flag one, give the whole corrected translation in "fixed": keep every ⟦n⟧ marker exactly once, keep line breaks, follow the glossary, change only what's needed.

${authorLine(req as TranslateRequest)}
${glossary.length ? `Glossary (use exactly):\n${glossary.map(([k, v]) => `- ${k} → ${v}`).join("\n")}` : ""}
${req.doNotTranslate?.length ? `Keep exactly as written: ${req.doNotTranslate.join(", ")}` : ""}${voiceSection(target, req.voice)}

Return one result for EVERY segment id.`;
}

export function checkUser(target: Language, page: string, segs: CheckSegment[]): string {
  const items = segs.map((s) => ({ id: s.id, original: s.source, [target.code]: s.translation }));
  return `Check these ${target.name} (${target.code}) translations from ${page}.\n<segments>\n${JSON.stringify(items, null, 1)}\n</segments>`;
}

export function checkCall(lang: string, page: string, segs: CheckSegment[], req: Pick<TranslateRequest, "author" | "voice" | "glossary" | "doNotTranslate">): StructuredCall {
  const target = getLanguage(lang);
  if (!target) throw new Error(`Unsupported language: ${lang}`);
  return {
    system: checkSystem(target, req),
    user: checkUser(target, page, segs),
    toolName: "submit_review",
    toolDescription: "Submit the review result for every segment.",
    schema: CHECK_SCHEMA,
    maxTokens: 16000,
  };
}

/** Groups segments into requests of about `maxChars` of original text. */
export function chunkCheck<S extends CheckSegment>(segs: S[], maxChars = 3000): S[][] {
  const out: S[][] = [];
  let cur: S[] = [];
  let n = 0;
  for (const s of segs) {
    if (cur.length && n + s.source.length > maxChars) {
      out.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(s);
    n += s.source.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** A usable fix, or null (keep the translation as it is). */
export function acceptFix(seg: CheckSegment, r: CheckResult | undefined, lang: string): string | null {
  if (!r || r.verdict !== "fix" || typeof r.fixed !== "string") return null;
  const fixed = r.fixed.trim();
  if (!fixed || fixed === seg.translation.trim()) return null;
  return validateTranslation(seg.source, { id: seg.id, sourceLanguage: "", action: "translated", translation: fixed }, lang) ? null : fixed;
}
