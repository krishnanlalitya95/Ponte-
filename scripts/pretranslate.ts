/**
 * Pre-translate a published site so no visitor ever waits for the agent.
 *
 *   npm run pretranslate -- --url https://lalityakrishnan.in --langs hi,ta,es
 *   npm run pretranslate -- --url https://lalityakrishnan.in --langs hi --max-pages 5 --dry-run
 *
 * It loads each page's published HTML, finds text exactly the way the visitor widget
 * does (same code), translates what isn't saved yet, and saves it to the configured
 * store (PONTE_STORE / PONTE_GITHUB_* — see .env.example). Already-saved text costs nothing.
 * Same-site links are followed up to --max-pages.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { AnthropicModelClient, Ponte, getLanguage, type TranslateRequest } from "../src/core/index.js";
import { MockModelClient } from "../src/core/mock.js";
import { storeFromEnv } from "../src/core/store.js";
import { createPonte } from "../widget/engine.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(resolve(root, ".env"));
} catch {
  /* no .env */
}

const args = parseArgs(process.argv.slice(2));
const startUrls = (args.url ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const langs = (args.langs ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const maxPages = Number(args["max-pages"] ?? 30);
const dryRun = "dry-run" in args;
if (!startUrls.length || !langs.length) {
  console.error("Usage: npm run pretranslate -- --url https://your-site --langs hi,ta[,…] [--max-pages 30] [--dry-run]");
  process.exit(1);
}
for (const l of langs) if (!getLanguage(l)) throw new Error(`Unsupported language: ${l}`);

const mock = process.env.PONTE_MOCK === "1";
const store = storeFromEnv(root, mock ? { ...process.env, PONTE_STORE: "memory" } : process.env);
const ponte = new Ponte({ model: mock ? new MockModelClient() : new AnthropicModelClient(), store });
const realFetch = globalThis.fetch;
const FAKE_ENDPOINT = "http://ponte.internal";

const totals = { pages: 0, segments: 0, saved: 0, translated: 0, failed: 0, calls: 0, inTok: 0, outTok: 0 };

// --- crawl -----------------------------------------------------------------
const origin = new URL(startUrls[0]!).origin;
const queue = [...startUrls.map(normalize)];
const seen = new Set(queue);
const pages: Array<{ url: string; html: string }> = [];
while (queue.length && pages.length < maxPages) {
  const url = queue.shift()!;
  const res = await realFetch(url, { headers: { "User-Agent": "Ponte pre-translate" } });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) {
    console.log(`  skip ${url} (HTTP ${res.status})`);
    continue;
  }
  const html = await res.text();
  pages.push({ url, html });
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
  dom.window.close();
}
console.log(`Found ${pages.length} page(s) on ${origin}`);

// --- translate ---------------------------------------------------------------
for (const page of pages) {
  for (const lang of langs) {
    const dom = new JSDOM(page.html, { url: page.url });
    installGlobals(dom);
    let segCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (!u.startsWith(FAKE_ENDPOINT)) return realFetch(input, init);
      const body = JSON.parse(String(init?.body)) as TranslateRequest;
      segCount += body.segments.length;
      if (dryRun) {
        for (const s of body.segments) console.log(`    [${s.role}] ${s.text.slice(0, 90).replace(/\n/g, " ⏎ ")}`);
        return json({ targetLanguage: lang, brief: null, results: [], usage: {}, model: "dry-run" });
      }
      const out = await ponte.translate(body);
      totals.calls += out.usage.modelCalls;
      totals.inTok += out.usage.inputTokens;
      totals.outTok += out.usage.outputTokens;
      for (const r of out.results) {
        if (r.saved) totals.saved++;
        else if (r.status === "translated" || r.status === "unchanged") totals.translated++;
        else if (r.status === "fallback") totals.failed++;
      }
      return json(out);
    }) as typeof fetch;

    const status: string[] = [];
    const engine = createPonte({
      endpoint: FAKE_ENDPOINT,
      observe: false,
      remember: false,
      persist: false,
      sourceLanguage: process.env.PONTE_SOURCE_LANGUAGE,
      onStatus: (s) => s.error && status.push(s.error),
    });
    await engine.translate(lang);
    totals.segments += segCount;
    console.log(`  ${lang}  ${page.url}  (${segCount} blocks)${status.length ? "  ERROR: " + status.join("; ") : ""}`);
    dom.window.close();
  }
  totals.pages++;
}
globalThis.fetch = realFetch;

await store.flush();
console.log(
  `\nDone: ${totals.pages} page(s) × ${langs.length} language(s). ` +
    `${totals.translated} newly translated, ${totals.saved} already saved, ${totals.failed} failed. ` +
    `${totals.calls} agent calls, ${totals.inTok} in / ${totals.outTok} out tokens.`,
);
if (totals.failed) process.exitCode = 1;

// --- helpers -----------------------------------------------------------------
function installGlobals(dom: JSDOM) {
  const w = dom.window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ["window", "document", "NodeFilter", "Node", "MutationObserver", "CustomEvent", "location", "localStorage"]) {
    Object.defineProperty(g, k, { value: k === "window" ? dom.window : w[k], configurable: true, writable: true });
  }
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
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
