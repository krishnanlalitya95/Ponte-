/**
 * Pre-translate a published site so no visitor ever waits for the agent.
 *
 *   npm run pretranslate -- --url https://lalityakrishnan.in                 # languages from ponte.config.json
 *   npm run pretranslate -- --url https://lalityakrishnan.in --langs hi,ta --batch
 *   npm run pretranslate -- --url https://lalityakrishnan.in --estimate      # what it would cost; no API calls
 *
 * 1. Crawls the site (same-site links, up to --max-pages) and finds text on each page
 *    exactly the way the visitor widget does (same code).
 * 2. Skips everything already saved with the current settings — that costs nothing.
 * 3. Reads each page once (a "brief" shared by all languages and saved for next time).
 * 4. Translates the rest. With --batch, every request goes out as one Message Batch:
 *    half the price, results usually within minutes (at most 24 h).
 * 5. Saves to the configured store (PONTE_STORE / PONTE_GITHUB_*).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { AnthropicModelClient, Ponte, getLanguage, type Segment, type SegmentResult, type TranslateRequest } from "../src/core/index.js";
import type { ChunkOutcome, Plan, RawResult, Usage } from "../src/core/agent.js";
import type { ContentBrief } from "../src/core/types.js";
import type { StructuredResult } from "../src/core/model.js";
import { MockModelClient } from "../src/core/mock.js";
import { storeFromEnv } from "../src/core/store.js";
import { loadConfig, withConfig } from "../src/core/config.js";
import { createPonte } from "../widget/engine.js";

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
const totalBlocks = todo.reduce((n, j) => n + j.plan.unique.length, 0);
// Rough cost from earlier runs: about $0.70 per 1,000 blocks live (half as a batch), plus
// about $0.03 per page reading, and readings are only paid for once per page.
const pagesToRead = new Set(todo.map((j) => j.page)).size;
const est = (totalBlocks / 1000) * 0.7;
const read = pagesToRead * 0.03;
console.log(
  `  total ${totalBlocks} block(s) on ${pagesToRead} page(s) — roughly $${(est + read).toFixed(2)} live, ` +
    `$${(est / 2 + read).toFixed(2)} as a batch (estimate; Indian scripts cost more than European ones)`,
);
if (estimate || !totalBlocks) {
  if (!totalBlocks) console.log("\nEverything is already translated. Nothing to do.");
  process.exit(0);
}

// --- 3. one reading per page, shared by all languages -----------------------------------
const usage: Usage = { inputTokens: 0, outputTokens: 0, storedSegments: 0, modelCalls: 0 };
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
let batchIn = 0;
let batchOut = 0;
if (useBatch && model.batch) {
  const res = await model.batch(work.map((w) => ({ id: w.id, call: w.call })), (m) => console.log(`  ${m}`));
  for (const w of work) outcomes.set(w.id, toOutcome(res.get(w.id)));
  for (const r of res.values()) {
    if (r instanceof Error) continue;
    batchIn += r.inputTokens;
    batchOut += r.outputTokens;
  }
} else {
  let next = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (next < work.length) {
        const w = work[next++]!;
        try {
          const r = await model.structured<{ results: RawResult[] }>(w.call);
          usage.modelCalls++;
          usage.inputTokens += r.inputTokens;
          usage.outputTokens += r.outputTokens;
          outcomes.set(w.id, toOutcome(r));
        } catch (e) {
          outcomes.set(w.id, { raw: [], error: e instanceof Error ? e.message : String(e) });
        }
      }
    }),
  );
}

// --- 5. check, retry failures once (live), save -----------------------------------------
const totals = { translated: 0, failed: 0 };
const errors = new Map<string, number>();
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

const cost = usage.inputTokens * PRICE.in + usage.outputTokens * PRICE.out + (batchIn * PRICE.in + batchOut * PRICE.out) / 2;
console.log(
  `\nDone: ${totals.translated} block(s) translated, ${totals.failed} failed. ` +
    `Tokens: ${usage.inputTokens + batchIn} in / ${usage.outputTokens + batchOut} out — about $${cost.toFixed(2)}.`,
);
if (totals.failed) {
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
