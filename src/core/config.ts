import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeLanguageCode } from "./languages.js";
import type { Author, TranslateRequest, Voice } from "./types.js";

/**
 * Site-wide translation settings, kept in ponte.config.json at the repo root.
 * Applied to every request by the server and by pre-translate, so the widget
 * doesn't need to send them.
 *
 *   {
 *     "author": { "name": "…", "gender": "male", "notes": "…" },
 *     "voice": "everyday",
 *     "doNotTranslate": ["CareOne"],
 *     "glossary": { "hi": { "Lalitya Krishnan": "लालित्य कृष्णन" } }
 *   }
 */
export interface PonteConfig {
  /** The language the site is written in (most of it). Default: the page's <html lang>. */
  sourceLanguage?: string;
  /**
   * Languages offered to visitors (besides the page language). Pre-translate translates
   * these by default and only these are published. Saved translations for other
   * languages stay in the repo, so a language can be brought back later.
   */
  languages?: string[];
  author?: Author;
  /** "everyday" (how people really talk), "standard" or "formal". Changing it re-translates saved text. */
  voice?: Voice;
  /** Look of the visitor picker, published with the translations. */
  widget?: {
    accent?: string;
    /** Brand gradient (top → bottom): fills the landing note, colours the picker icon and shadows. */
    brand?: { from: string; to: string };
    /** Logos next to widget.js (from assets/): light on the gradient note, dark (colour) in the menu. */
    logo?: { light?: string; dark?: string; alt?: string };
    position?: "bottom-right" | "bottom-left";
    /** Open in the visitor's device language when it's offered. Off: always start in the page language. */
    autoDetect?: boolean;
    /** "Share this page in …" in the language menu (native share sheet, or copy link). On unless false. */
    share?: boolean;
    /** Last item in the language list, linking to the Gloss case study. */
    about?: { title?: string; text?: string; linkLabel?: string; url?: string };
    /** Green note that opens around the picker on landing (see widget/embed.ts → Callout). */
    callout?: {
      enabled?: boolean;
      title?: string;
      text?: string;
      linkLabel?: string;
      linkUrl?: string;
      delayMs?: number;
      showForMs?: number;
      frequency?: "session" | "always";
    };
  };
  doNotTranslate?: string[];
  /** Fixed renderings per target language: { "<lang>": { "<source term>": "<rendering>" } }. */
  glossary?: Record<string, Record<string, string>>;
}

export function loadConfig(root: string): PonteConfig {
  const path = join(root, "ponte.config.json");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  try {
    return JSON.parse(text) as PonteConfig;
  } catch (e) {
    throw new Error(`ponte.config.json is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
}

/** Merge site settings into a request. Values sent with the request win over the file. */
export function withConfig(req: TranslateRequest, config: PonteConfig): TranslateRequest {
  const lang = normalizeLanguageCode(req.targetLanguage);
  const glossary = { ...(config.glossary?.[lang] ?? {}), ...(req.glossary ?? {}) };
  const dnt = [...new Set([...(config.doNotTranslate ?? []), ...(req.doNotTranslate ?? [])])];
  return {
    ...req,
    sourceLanguage: req.sourceLanguage ?? config.sourceLanguage,
    author: req.author ?? config.author,
    voice: req.voice ?? config.voice,
    glossary: Object.keys(glossary).length ? glossary : undefined,
    doNotTranslate: dnt.length ? dnt : undefined,
  };
}
