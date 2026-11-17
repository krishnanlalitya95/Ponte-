import { LruCache, hashKey } from "./cache.js";
import { MemoryStore, type StoredTranslation, type TranslationStore } from "./store.js";
import { getLanguage, isUntranslatable, normalizeLanguageCode, scriptCandidates, type Language } from "./languages.js";
import type { ModelClient } from "./model.js";
import {
  ANALYZE_SYSTEM,
  BRIEF_SCHEMA,
  MARKER_RE,
  TRANSLATION_SCHEMA,
  analyzeUser,
  translateSystem,
  translateUser,
} from "./prompts.js";
import type {
  ContentBrief,
  Segment,
  SegmentResult,
  TranslateRequest,
  TranslateResponse,
} from "./types.js";
import { CONTENT_TYPES } from "./types.js";

export class PonteError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface PonteOptions {
  model: ModelClient;
  /** Max source characters per translation call. Indic scripts expand in tokens, so keep this modest. */
  chunkChars?: number;
  /** Max characters the reading step sees. Long pages are sampled from the top. */
  analysisChars?: number;
  /** Parallel translation calls per request. */
  concurrency?: number;
  /** Max tokens for a translation call. */
  maxOutputTokens?: number;
  /** Where translations are saved and reused. Defaults to memory (nothing persisted). */
  store?: TranslationStore;
}

interface RawResult {
  id: string;
  sourceLanguage: string;
  action: "translated" | "unchanged";
  translation: string;
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
  storedSegments: number;
  modelCalls: number;
}

/**
 * The Ponte agent: detect → contextualize → meaning-first translate → structured replacements.
 */
export class Ponte {
  private readonly model: ModelClient;
  private readonly chunkChars: number;
  private readonly analysisChars: number;
  private readonly concurrency: number;
  private readonly maxOutputTokens: number;
  readonly store: TranslationStore;
  private readonly briefCache = new LruCache<ContentBrief>(500);

  constructor(opts: PonteOptions) {
    this.model = opts.model;
    this.chunkChars = opts.chunkChars ?? 4000;
    this.analysisChars = opts.analysisChars ?? 16000;
    this.concurrency = opts.concurrency ?? 3;
    this.maxOutputTokens = opts.maxOutputTokens ?? 16000;
    this.store = opts.store ?? new MemoryStore();
  }

  async translate(req: TranslateRequest): Promise<TranslateResponse> {
    const target = getLanguage(req.targetLanguage);
    if (!target) throw new PonteError(`Unsupported target language: ${req.targetLanguage}`);
    if (req.contentType && !CONTENT_TYPES.includes(req.contentType)) {
      throw new PonteError(`Unknown contentType: ${req.contentType}`);
    }
    validateSegments(req.segments);

    const usage: Usage = { inputTokens: 0, outputTokens: 0, storedSegments: 0, modelCalls: 0 };
    const results = new Map<string, SegmentResult>();
    const contextKey = hashKey(req.context?.url, req.context?.title, req.contentType, JSON.stringify(req.glossary ?? {}), (req.doNotTranslate ?? []).join("|"));

    // 1. Detect: cheap local pass — skip what obviously needs no model.
    const pending: Segment[] = [];
    for (const seg of req.segments) {
      if (isUntranslatable(seg.text)) {
        results.set(seg.id, { id: seg.id, text: seg.text, sourceLanguage: "und", status: "skipped", reason: "no translatable text" });
        continue;
      }
      if (req.sourceLanguage && normalizeLanguageCode(req.sourceLanguage) === target.code) {
        results.set(seg.id, { id: seg.id, text: seg.text, sourceLanguage: target.code, status: "unchanged", reason: "already in target language" });
        continue;
      }
      const cands = scriptCandidates(seg.text);
      if (cands.length === 1 && cands[0] === target.code) {
        results.set(seg.id, { id: seg.id, text: seg.text, sourceLanguage: target.code, status: "unchanged", reason: "already in target language" });
        continue;
      }
      const saved = await this.store.get(target.code, seg.text);
      if (saved) {
        results.set(seg.id, { id: seg.id, text: saved.text, sourceLanguage: saved.sourceLanguage, status: saved.status, saved: true });
        usage.storedSegments++;
        continue;
      }
      pending.push(seg);
    }

    // De-duplicate identical text (nav items, repeated CTAs) so each is translated once.
    const firstIdByText = new Map<string, string>();
    const duplicates = new Map<string, string>(); // dup id -> canonical id
    const unique: Segment[] = [];
    for (const seg of pending) {
      const canonical = firstIdByText.get(seg.text);
      if (canonical) duplicates.set(seg.id, canonical);
      else {
        firstIdByText.set(seg.text, seg.id);
        unique.push(seg);
      }
    }

    // 2. Contextualize: read the whole page (not just pending bits) and write a brief.
    //    Skipped entirely when everything was already saved — no model calls at all.
    let brief: ContentBrief | null = null;

    // 3. Translate for meaning, chunked, with continuity context between chunks.
    if (unique.length) {
      brief = await this.getBrief(req, target, contextKey, usage);
      const b = brief;
      const chunks = chunkSegments(unique, this.chunkChars);
      const translated = await mapLimit(chunks, this.concurrency, (chunk, i) => {
        const prev = chunks[i - 1];
        const precedingContext = prev ? prev.slice(-3).map((s) => s.text) : [];
        return this.translateChunk(req, target, b, chunk, precedingContext, usage);
      });
      const toSave: StoredTranslation[] = [];
      const savedAt = new Date().toISOString();
      const textById = new Map(unique.map((s) => [s.id, s.text]));
      for (const chunkResults of translated) {
        for (const r of chunkResults) {
          results.set(r.id, r);
          const source = textById.get(r.id);
          if (source !== undefined && (r.status === "translated" || r.status === "unchanged")) {
            toSave.push({
              source,
              text: r.text,
              status: r.status,
              sourceLanguage: r.sourceLanguage,
              contentType: b.contentType,
              page: req.context?.url,
              model: this.model.model,
              savedAt,
            });
          }
        }
      }
      await this.store.put(target.code, toSave);
      for (const [dupId, canonicalId] of duplicates) {
        const r = results.get(canonicalId);
        if (r) results.set(dupId, { ...r, id: dupId });
      }
    }

    return {
      targetLanguage: target.code,
      brief,
      results: req.segments.map(
        (s) =>
          results.get(s.id) ?? { id: s.id, text: s.text, sourceLanguage: "und", status: "fallback", reason: "no result" },
      ),
      usage,
      model: this.model.model,
    };
  }

  private async getBrief(req: TranslateRequest, target: Language, contextKey: string, usage: Usage): Promise<ContentBrief> {
    // The brief depends on the page, not on which segments still need work, so
    // incremental requests from the same page (e.g. lazily rendered sections) reuse it.
    const pageKey = req.context?.url
      ? hashKey("brief", target.code, contextKey)
      : hashKey("brief", target.code, contextKey, req.segments.map((s) => s.text).join("\n").slice(0, this.analysisChars));
    const cached = this.briefCache.get(pageKey);
    if (cached) return cached;

    const sample: Segment[] = [];
    let used = 0;
    for (const s of req.segments) {
      if (isUntranslatable(s.text)) continue;
      if (used + s.text.length > this.analysisChars) {
        if (!sample.length) sample.push({ ...s, text: s.text.slice(0, this.analysisChars) });
        break;
      }
      sample.push(s);
      used += s.text.length;
    }

    const res = await this.model.structured<ContentBrief>({
      system: ANALYZE_SYSTEM,
      user: analyzeUser(req, target, sample),
      toolName: "write_brief",
      toolDescription: "Record your reading of the page as a brief for the translator.",
      schema: BRIEF_SCHEMA,
      maxTokens: 3000,
    });
    usage.modelCalls++;
    usage.inputTokens += res.inputTokens;
    usage.outputTokens += res.outputTokens;

    const brief = sanitizeBrief(res.data, req);
    this.briefCache.set(pageKey, brief);
    return brief;
  }

  private async translateChunk(
    req: TranslateRequest,
    target: Language,
    brief: ContentBrief,
    chunk: Segment[],
    precedingContext: string[],
    usage: Usage,
    attempt = 1,
  ): Promise<SegmentResult[]> {
    let raw: RawResult[] = [];
    let error: string | undefined;
    try {
      const res = await this.model.structured<{ results: RawResult[] }>({
        system: translateSystem(target),
        user: translateUser({ req, target, brief, segments: chunk, precedingContext }),
        toolName: "submit_translations",
        toolDescription: "Submit the translation for every segment.",
        schema: TRANSLATION_SCHEMA,
        maxTokens: this.maxOutputTokens,
      });
      usage.modelCalls++;
      usage.inputTokens += res.inputTokens;
      usage.outputTokens += res.outputTokens;
      raw = Array.isArray(res.data?.results) ? res.data.results : [];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const byId = new Map(raw.map((r) => [String(r.id), r]));
    const good: SegmentResult[] = [];
    const retry: Segment[] = [];
    for (const seg of chunk) {
      const r = byId.get(seg.id);
      const problem = !r ? "missing from model output" : validateTranslation(seg.text, r);
      if (!problem && r) {
        good.push({
          id: seg.id,
          text: r.action === "unchanged" ? seg.text : r.translation,
          sourceLanguage: normalizeLanguageCode(r.sourceLanguage || brief.dominantLanguage) || "und",
          status: r.action === "unchanged" ? "unchanged" : "translated",
        });
      } else {
        retry.push(seg);
        error ??= problem ?? undefined;
      }
    }

    if (retry.length && attempt < 2) {
      // Retry the failures once, in smaller pieces so one bad segment can't sink the rest.
      const smaller = chunkSegments(retry, Math.max(500, Math.floor(this.chunkChars / 4)));
      for (const piece of smaller) {
        good.push(...(await this.translateChunk(req, target, brief, piece, precedingContext, usage, attempt + 1)));
      }
    } else {
      for (const seg of retry) {
        good.push({ id: seg.id, text: seg.text, sourceLanguage: "und", status: "fallback", reason: error ?? "translation failed" });
      }
    }
    return good;
  }
}

function validateSegments(segments: unknown): asserts segments is Segment[] {
  if (!Array.isArray(segments) || segments.length === 0) throw new PonteError("segments must be a non-empty array");
  const seen = new Set<string>();
  for (const s of segments) {
    if (!s || typeof s !== "object") throw new PonteError("each segment must be an object");
    const { id, text } = s as Segment;
    if (typeof id !== "string" || !id) throw new PonteError("each segment needs a string id");
    if (typeof text !== "string") throw new PonteError(`segment ${id} needs string text`);
    if (seen.has(id)) throw new PonteError(`duplicate segment id: ${id}`);
    seen.add(id);
  }
}

/** Returns a problem description, or null when the translation is usable. */
export function validateTranslation(source: string, r: RawResult): string | null {
  if (r.action !== "translated" && r.action !== "unchanged") return "invalid action";
  if (r.action === "unchanged") return null;
  if (typeof r.translation !== "string" || !r.translation.trim()) return "empty translation";
  const want = (source.match(MARKER_RE) ?? []).sort().join("");
  const got = (r.translation.match(MARKER_RE) ?? []).sort().join("");
  if (want !== got) return "formatting markers not preserved";
  // Guard against runaway output (commentary, duplicated text).
  if (source.length > 20 && r.translation.length > source.length * 6 + 200) return "translation suspiciously long";
  return null;
}

function sanitizeBrief(b: Partial<ContentBrief>, req: TranslateRequest): ContentBrief {
  const contentType = req.contentType ?? (CONTENT_TYPES.includes(b.contentType as never) ? b.contentType! : "mixed");
  return {
    contentType,
    tone: String(b.tone ?? ""),
    register: String(b.register ?? ""),
    audience: String(b.audience ?? ""),
    summary: String(b.summary ?? ""),
    glossary: Array.isArray(b.glossary)
      ? b.glossary.filter((g) => g && typeof g.term === "string" && ["keep", "transliterate", "translate"].includes(g.treatment))
      : [],
    translationNotes: String(b.translationNotes ?? ""),
    dominantLanguage: normalizeLanguageCode(String(b.dominantLanguage ?? "und")) || "und",
  };
}

export function chunkSegments(segments: Segment[], maxChars: number): Segment[][] {
  const chunks: Segment[][] = [];
  let current: Segment[] = [];
  let size = 0;
  for (const s of segments) {
    if (current.length && size + s.text.length > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(s);
    size += s.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
