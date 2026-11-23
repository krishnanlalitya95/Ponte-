/**
 * Pre-translate a published site so no visitor ever waits for the agent.
 *
 *   npm run pretranslate -- --url https://lalityakrishnan.in                 # languages from ponte.config.json
 *   npm run pretranslate -- --url https://lalityakrishnan.in --langs hi,ta --batch
 *   npm run pretranslate -- --url https://lalityakrishnan.in --estimate      # what it would cost; no API calls
 *   npm run pretranslate -- --url https://lalityakrishnan.in --no-words      # skip word lookups
 *
 * 1. Crawls the site (same-site links, up to --max-pages) and finds text on each page
 *    exactly the way the visitor widget does (same code).
 * 2. Skips everything already saved with the current settings — that costs nothing.
 * 3. Reads each page once (a "brief" shared by all languages and saved for next time).
 * 4. Translates the rest. With --batch, every request goes out as one Message Batch:
 *    half the price, results usually within minutes (at most 24 h).
 * 5. Saves to the configured store (PONTE_STORE / PONTE_GITHUB_*).
 * 6. Prepares word lookups (select a word on the site → its meaning in any language) for
 *    text that doesn't have them yet, or whose translation changed. Skip with --no-words.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { AnthropicModelClient, Ponte, getLanguage, type Segment, type SegmentResult, type TranslateRequest } from "../src/core/index.js";
import type { ChunkOutcome, Plan, RawResult, Usage } from "../src/core/agent.js";
import type { ContentBrief } from "../src/core/types.js";
import type { StructuredCall, StructuredResult } from "../src/core/model.js";
import { MockModelClient } from "../src/core/mock.js";
import { storeFromEnv } from "../src/core/store.js";
import { loadConfig, withConfig } from "../src/core/config.js";
import { createPonte } from "../widget/engine.js";
import { scriptCandidates } from "../src/core/languages.js";
import { chunkWordSegments, cleanGlosses, plain, wordsCall, wordsSettings, wordsStoreKey, type WordGloss, type WordSegment } from "../src/core/words.js";
import type { StoredTranslation } from "../src/core/store.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(resolve(root, ".env"));
} catch {
  /* no .env */
}

const args = parseArgs(process.argv.slice(2));
const site = loadConfig(root);
const startUrls = (args.url ?? "").split(",").map((s) => s.trim()).filter(Boolean);
let langs = (args.langs ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!langs.length && site.languages?.length) {
  // The page language too, for text written in other languages (like Hindi poems on an English page).
  langs = [...new Set([site.sourceLanguage ?? "en", ...site.languages])];
  console.log(`Languages from ponte.config.json: ${langs.join(", ")}`);
}
const maxPages = Number(args["max-pages"] ?? 30);
const estimate = "estimate" in args || "dry-run" in args;
const useBatch = "batch" in args;
const withWords = !("no-words" in args);
if (!startUrls.length || !langs.length) {
  console.error("Usage: npm run pretranslate -- --url https://your-site [--langs hi,ta] [--batch] [--estimate] [--max-pages 30]");
  process.exit(1);
}
for (const l of langs) if (!getLanguage(l)) throw new Error(`Unsupported language: ${l}`);

const mock = process.env.PONTE_MOCK === "1";
const store = storeFromEnv(root, mock ? { ...process.env, PONTE_STORE: "memory" } : process.env);
const model = mock || estimate ? new MockModelClient() : new AnthropicModelClient();
const ponte = new Ponte({ model, store });
const realFetch = globalThis.fetch;
const PRICE = { in: 2 / 1e6, out: 10 / 1e6 }; // claude-sonnet-5-5, USD per token (batch: half)

// --- 1. crawl and find text -----------------------------------------------------------
const origin = new URL(startUrls[0]!).origin;
const queue = [...startUrls.map(normalize)];
const seen = new Set(queue);
const pages: Array<{ url: string; req: Omit<TranslateRequest, "targetLanguage"> }> = [];
while (queue.length && pages.length < maxPages) {
  const url = queue.shift()!;
  const res = await realFetch(url, { headers: { "User-Agent": "Ponte pre-translate" } });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) {
    console.log(`  skip ${url} (HTTP ${res.status})`);
    continue;
  }
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  for (const a of dom.window.document.querySelectorAll("a[href]")) {
    try {
      const next = normalize(new URL(a.getAttribute("href")!, url).toString());
      if (next.startsWith(origin) && !seen.has(next) && !/\.(pdf|png|jpe?g|gif|svg|webp|mp4|zip)$/i.test(next)) {
        seen.add(next);
        queue.push(next);
      }
    } catch {
      /* bad href */
    }
  }
  pages.push({ url, req: await collect(dom) });
  dom.window.close();
}
console.log(`Found ${pages.length} page(s) on ${origin}`);

// --- 2. what still needs translating ---------------------------------------------------
interface Job {
  page: string;
  req: TranslateRequest;
  plan: Plan;
  brief?: ContentBrief;
}
const jobs: Job[] = [];
for (const p of pages) {
  for (const lang of langs) {
    const req = withConfig({ ...p.req, targetLanguage: lang }, site);
    jobs.push({ page: p.url, req, plan: await ponte.prepare(req) });
  }
}
const todo = jobs.filter((j) => j.plan.unique.length);
const pendingChars = (js: Job[]) => js.reduce((n, j) => n + j.plan.unique.reduce((m, s) => m + s.text.length, 0), 0);
console.log("\nStill to translate (already-saved text is skipped for free):");
for (const lang of langs) {
  const js = todo.filter((j) => j.req.targetLanguage === lang);
  const blocks = js.reduce((n, j) => n + j.plan.unique.length, 0);
  console.log(`  ${lang}  ${String(blocks).padStart(4)} block(s), ${pendingChars(js)} characters`);
}
// Show where the new text is (for the first language that has some), so you can see what you'd pay for.
const showLang = process.env.PONTE_SHOW_PENDING || todo[0]?.req.targetLanguage;
for (const j of todo.filter((x) => x.req.targetLanguage === showLang)) {
  console.log(`\n  ${j.page} — ${j.plan.unique.length} new block(s) in ${showLang}, e.g.:`);
  for (const s of j.plan.unique.slice(0, 6)) console.log(`     · ${s.text.slice(0, 90).replace(/\n/g, " / ")}`);
}
const totalBlocks = todo.reduce((n, j) => n + j.plan.unique.length, 0);
// Rough cost from a real run on this site (17 Nov 2026: 5,044 blocks for $4.16 as a batch):
// about $1.60 per 1,000 blocks live, half as a batch, plus ~$0.05 per page reading
// (paid once per page; later runs reuse it).
const pagesToRead = new Set(todo.map((j) => j.page)).size;
const est = (totalBlocks / 1000) * 1.6;
const read = pagesToRead * 0.05;
console.log(
  `  total ${totalBlocks} block(s) on ${pagesToRead} page(s) — roughly $${(est + read).toFixed(2)} live, ` +
    `$${(est / 2 + read).toFixed(2)} as a batch (estimate; Indian scripts cost more than European ones)`,
);
const sourceLang = site.sourceLanguage ?? "en";
/** How a block reads in `lang` right now (its saved translation, or itself if it's already in that language). */
async function shownIn(lang: string, source: string): Promise<string | undefined> {
  const saved = await store.get(lang, source);
  if (saved) return saved.text;
  const cands = scriptCandidates(plain(source));
  if (lang === sourceLang && (!cands.length || cands.includes(lang))) return source;
  return undefined;
}
let wordsPending = 0;
if (withWords) {
  const pendingKeys = new Set(todo.flatMap((j) => j.plan.unique.map((u) => `${j.req.targetLanguage}\0${u.text}`)));
  const counted = new Set<string>();
  for (const p of pages)
    for (const lang of langs)
      for (const seg of p.req.segments) {
        if (!/\p{L}/u.test(plain(seg.text)) || counted.has(`${lang}\0${seg.text}`)) continue;
        counted.add(`${lang}\0${seg.text}`);
        const shown = await shownIn(lang, seg.text);
        if (shown === undefined) {
          if (pendingKeys.has(`${lang}\0${seg.text}`)) wordsPending++;
          continue;
        }
        if ((await store.get(wordsStoreKey(lang), seg.text))?.settings !== wordsSettings(shown)) wordsPending++;
      }
  // Rough: word lookups write more than translations do (several short meanings per block).
  const w = (wordsPending / 1000) * 2.4;
  console.log(`  word lookups: ${wordsPending} block(s) to prepare — roughly $${w.toFixed(2)} live, $${(w / 2).toFixed(2)} as a batch`);
}
if (estimate || (!totalBlocks && !wordsPending)) {
  if (!totalBlocks && !wordsPending) console.log("\nEverything is already translated. Nothing to do.");
  process.exit(0);
}

const usage: Usage = { inputTokens: 0, outputTokens: 0, storedSegments: 0, modelCalls: 0 };
let batchIn = 0;
let batchOut = 0;
const totals = { translated: 0, failed: 0 };
const errors = new Map<string, number>();

/** Sends requests as one batch (half price) or three at a time. */
async function runCalls<T>(calls: Array<{ id: string; call: StructuredCall }>): Promise<Map<string, StructuredResult<T> | Error>> {
  const out = new Map<string, StructuredResult<T> | Error>();
  if (useBatch && model.batch) {
    const res = await model.batch(calls, (m) => console.log(`  ${m}`));
    for (const [id, r] of res) {
      out.set(id, r as StructuredResult<T> | Error);
      if (r instanceof Error) continue;
      batchIn += r.inputTokens;
      batchOut += r.outputTokens;
    }
    return out;
  }
  let next = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (next < calls.length) {
        const c = calls[next++]!;
        try {
          const r = await model.structured<T>(c.call);
          usage.modelCalls++;
          usage.inputTokens += r.inputTokens;
          usage.outputTokens += r.outputTokens;
          out.set(c.id, r);
        } catch (e) {
          out.set(c.id, e instanceof Error ? e : new Error(String(e)));
        }
      }
    }),
  );
  return out;
}

if (totalBlocks) {
// --- 3. one reading per page, shared by all languages -----------------------------------
const briefs = new Map<string, ContentBrief>();
for (const j of todo) {
  if (!briefs.has(j.page)) briefs.set(j.page, await ponte.getBrief(j.req, usage));
  j.brief = briefs.get(j.page)!;
}
console.log(`\nRead ${briefs.size} page(s) (${usage.modelCalls} new reading(s); the rest were saved from before)`);

// --- 4. translate ------------------------------------------------------------------------
const work = todo.flatMap((j, ji) => ponte.buildChunks(j.req, j.plan, j.brief!).map((w, wi) => ({ id: `j${ji}-c${wi}`, ji, ...w })));
console.log(`Translating ${totalBlocks} block(s) in ${work.length} request(s)${useBatch ? " as one batch (half price)" : ""}…`);
const outcomes = new Map<string, ChunkOutcome>();
const res = await runCalls<{ results: RawResult[] }>(work.map((w) => ({ id: w.id, call: w.call })));
for (const w of work) outcomes.set(w.id, toOutcome(res.get(w.id)));

// --- 5. check, retry failures once (live), save -----------------------------------------
for (const [ji, j] of todo.entries()) {
  const results: SegmentResult[] = [];
  for (const w of work.filter((x) => x.ji === ji)) {
    results.push(...(await ponte.settleChunk(j.req, j.plan, j.brief!, w, outcomes.get(w.id)!, usage)));
  }
  await ponte.finish(j.req, j.plan, j.brief!, results);
  for (const r of results) {
    if (r.status === "fallback") {
      totals.failed++;
      errors.set(r.reason ?? "?", (errors.get(r.reason ?? "?") ?? 0) + 1);
    } else totals.translated++;
  }
}
await store.flush();
}

// --- 6. word lookups ---------------------------------------------------------------------
const wordTotals = { saved: 0, failed: 0 };
if (withWords) {
  const jobsByLang = new Map<string, Array<WordSegment & { page: string }>>();
  for (const p of pages)
    for (const lang of langs) {
      const seen = new Set<string>();
      for (const seg of p.req.segments) {
        if (seen.has(seg.text) || !/\p{L}/u.test(plain(seg.text))) continue;
        seen.add(seg.text);
        const shown = await shownIn(lang, seg.text);
        if (shown === undefined) continue;
        if ((await store.get(wordsStoreKey(lang), seg.text))?.settings === wordsSettings(shown)) continue;
        const list = jobsByLang.get(lang) ?? [];
        if (!list.some((x) => x.source === seg.text)) list.push({ id: `w${list.length}`, source: seg.text, shown, page: p.url });
        jobsByLang.set(lang, list);
      }
    }
  const calls: Array<{ id: string; call: StructuredCall; lang: string; segs: Array<WordSegment & { page: string }> }> = [];
  for (const [lang, segs] of jobsByLang)
    for (const [i, chunk] of chunkWordSegments(segs).entries()) calls.push({ id: `words-${lang}-${i}`, call: wordsCall(lang, chunk, site.voice), lang, segs: chunk });
  const blocks = calls.reduce((n, c) => n + c.segs.length, 0);
  if (blocks) {
    console.log(`\nPreparing word lookups for ${blocks} block(s) in ${calls.length} request(s)${useBatch ? " as one batch (half price)" : ""}…`);
    const res = await runCalls<{ results: Array<{ id: string; words: Array<Partial<WordGloss>> }> }>(calls.map(({ id, call }) => ({ id, call })));
    for (const c of calls) {
      const r = res.get(c.id);
      if (!r || r instanceof Error) {
        wordTotals.failed += c.segs.length;
        if (r) errors.set(`word lookups: ${r.message}`, (errors.get(`word lookups: ${r.message}`) ?? 0) + 1);
        continue;
      }
      const byId = new Map(r.data.results.map((x) => [x.id, x.words]));
      const entries: StoredTranslation[] = [];
      for (const seg of c.segs) {
        const words = cleanGlosses(byId.get(seg.id), seg.source, seg.shown);
        if (!words.length && /\p{L}{3,}/u.test(plain(seg.source)) && !byId.has(seg.id)) {
          wordTotals.failed++;
          continue;
        }
        entries.push({
          source: seg.source,
          text: seg.shown,
          status: "translated",
          sourceLanguage: sourceLang,
          page: seg.page,
          model: model.model,
          savedAt: new Date().toISOString(),
          settings: wordsSettings(seg.shown),
          words,
        });
      }
      await store.put(wordsStoreKey(c.lang), entries);
      wordTotals.saved += entries.length;
    }
    await store.flush();
    console.log(`Word lookups: ${wordTotals.saved} block(s) saved${wordTotals.failed ? `, ${wordTotals.failed} failed (run again to retry)` : ""}.`);
  }
}

const cost = usage.inputTokens * PRICE.in + usage.outputTokens * PRICE.out + (batchIn * PRICE.in + batchOut * PRICE.out) / 2;
console.log(
  `\nDone: ${totals.translated} block(s) translated, ${totals.failed} failed. ` +
    `Tokens: ${usage.inputTokens + batchIn} in / ${usage.outputTokens + batchOut} out — about $${cost.toFixed(2)}.`,
);
if (totals.failed || wordTotals.failed) {
  for (const [why, n] of errors) console.error(`  ${n}× ${why.slice(0, 300)}`);
  console.error("Run again to retry the failures (saved work is kept).");
  process.exitCode = 1;
}

// --- helpers -----------------------------------------------------------------------------
function toOutcome(r: StructuredResult<unknown> | Error | undefined): ChunkOutcome {
  if (!r) return { raw: [], error: "no result" };
  if (r instanceof Error) return { raw: [], error: r.message };
  const data = r.data as { results?: RawResult[] };
  return { raw: Array.isArray(data?.results) ? data.results : [] };
}

/** Run the visitor widget's own text detection on a page and capture what it would send. */
async function collect(dom: JSDOM): Promise<Omit<TranslateRequest, "targetLanguage">> {
  const w = dom.window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ["window", "document", "NodeFilter", "Node", "MutationObserver", "CustomEvent", "location", "localStorage", "getComputedStyle"]) {
    Object.defineProperty(g, k, { value: k === "window" ? dom.window : w[k], configurable: true, writable: true });
  }
  const segments: Segment[] = [];
  let context: TranslateRequest["context"];
  globalThis.fetch = (async (_u: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as TranslateRequest;
    segments.push(...body.segments);
    context = body.context;
    return new Response(JSON.stringify({ results: [] }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    await createPonte({ endpoint: "http://collect", observe: false, remember: false, persist: false, fonts: false }).translate("hi");
  } finally {
    globalThis.fetch = realFetch;
  }
  const sourceLanguage = site.sourceLanguage || dom.window.document.documentElement.lang || "en";
  return { segments, context, sourceLanguage };
}

function normalize(u: string) {
  const url = new URL(u);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "") || url.origin;
}

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = "";
  }
  return out;
}
