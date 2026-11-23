/**
 * Build the static site that the widget reads in Static mode:
 *
 *   public/widget.js          the visitor widget
 *   public/t/<lang>.json      { "<text hash>": "<translation>" } for every saved translation
 *   public/t/words/<lang>.json { "<text hash>": [[word, in this language, meaning here, dictionary], …] }
 *                             for "select a word" (loaded only when a visitor selects one)
 *   public/t/index.json       which languages are published, with counts
 *   public/index.html         a small status page
 *
 *   npm run build:static -- --translations translations --out public
 *
 * The workflow "Publish translations" runs this and deploys public/ to GitHub Pages.
 */
import { copyFile, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../src/core/languages.js";
import type { LanguageFile } from "../src/core/store.js";
import { textHash } from "../widget/engine.js";
import { loadConfig, withConfig, type PonteConfig } from "../src/core/config.js";
import { settingsKey } from "../src/core/agent.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface StaticBuildResult {
  languages: Array<{ code: string; name: string; entries: number; waitingForRetranslation?: number }>;
  /** Languages with word lookups published. */
  words: string[];
}

export async function buildStatic(
  translationsDir: string,
  outDir: string,
  only?: string[],
  widget?: Record<string, unknown>,
  site?: PonteConfig,
): Promise<StaticBuildResult> {
  await mkdir(join(outDir, "t"), { recursive: true });
  let files: string[] = [];
  try {
    files = (await readdir(translationsDir)).filter((f) => /^[a-z]{2,3}\.json$/.test(f));
  } catch {
    console.warn(`No translations folder at ${translationsDir} yet — publishing the widget only.`);
  }

  const languages: StaticBuildResult["languages"] = [];
  for (const f of files.sort()) {
    const code = f.replace(/\.json$/, "");
    const lang = LANGUAGES.find((l) => l.code === code);
    if (!lang) continue;
    if (only && !only.includes(code)) continue; // not offered right now (kept in the repo)
    const data = JSON.parse(await readFile(join(translationsDir, f), "utf8")) as LanguageFile;
    const out: Record<string, string> = {};
    let stale = 0;
    const req = site ? withConfig({ targetLanguage: code, segments: [] }, site) : null;
    for (const e of Object.values(data)) {
      if (!e || typeof e.source !== "string" || typeof e.text !== "string") continue;
      // Translations made under older settings (glossary, voice, keep-as-is terms, author) stay
      // published until Pre-translate redoes them, so a settings change never turns the site
      // back to English. They're counted so the build log shows what the next run will redo.
      if (req && !e.locked && e.settings !== settingsKey(req, code, e.source)) stale++;
      // Same key the widget computes from the text it finds on the page.
      out[textHash(e.source.trim())] = e.text;
    }
    await writeFile(join(outDir, "t", `${code}.json`), JSON.stringify(out));
    languages.push({ code, name: lang.name, entries: Object.keys(out).length, ...(stale ? { waitingForRetranslation: stale } : {}) });
  }

  // Same order as the settings file, so the picker lists languages the way you listed them.
  if (only) languages.sort((a, b) => only.indexOf(a.code) - only.indexOf(b.code));

  // Word lookups: translations/words-<lang>.json → t/words/<lang>.json, compact.
  const words: string[] = [];
  let wordFiles: string[] = [];
  try {
    wordFiles = (await readdir(translationsDir)).filter((f) => /^words-[a-z]{2,3}\.json$/.test(f));
  } catch {
    /* none yet */
  }
  if (wordFiles.length) await mkdir(join(outDir, "t", "words"), { recursive: true });
  for (const f of wordFiles.sort()) {
    const code = f.replace(/^words-|\.json$/g, "");
    if (!LANGUAGES.some((l) => l.code === code) || (only && !only.includes(code))) continue;
    const data = JSON.parse(await readFile(join(translationsDir, f), "utf8")) as LanguageFile;
    const out: Record<string, string[][]> = {};
    for (const e of Object.values(data)) {
      if (!e || typeof e.source !== "string" || !Array.isArray(e.words) || !e.words.length) continue;
      out[textHash(e.source.trim())] = e.words.map((w) => [w.s, w.t, w.c, w.d]);
    }
    if (!Object.keys(out).length) continue;
    await writeFile(join(outDir, "t", "words", `${code}.json`), JSON.stringify(out));
    words.push(code);
  }
  if (only) words.sort((a, b) => only.indexOf(a) - only.indexOf(b));

  const updatedAt = new Date().toISOString();
  await writeFile(join(outDir, "t", "index.json"), JSON.stringify({ updatedAt, languages, words, widget: widget ?? {} }, null, 2));
  await copyFile(join(root, "dist", "ponte-widget.js"), join(outDir, "widget.js"));
  // Brand assets (logos) referenced by widget.logo in ponte.config.json.
  await cp(join(root, "assets"), outDir, { recursive: true }).catch(() => {});
  await writeFile(
    join(outDir, "index.html"),
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ponte translations</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#222}code{background:#f2f2f2;padding:2px 5px;border-radius:4px}td,th{padding:4px 12px 4px 0;text-align:left}</style>
<h1>Ponte translations</h1>
<p>Published ${updatedAt.slice(0, 16).replace("T", " ")} UTC.</p>
<table><tr><th>Language</th><th>Saved texts</th></tr>
${languages.map((l) => `<tr><td>${l.name} (${l.code})</td><td>${l.entries}</td></tr>`).join("\n") || "<tr><td colspan=2>None yet — run the Pre-translate site workflow.</td></tr>"}
</table>
<p>Add to Framer → Site Settings → Custom Code (end of body):</p>
<p><code>&lt;script src="…/widget.js" defer&gt;&lt;/script&gt;</code></p>
<script>document.querySelector("code").textContent = '<script src="' + location.origin + location.pathname.replace(/[^/]*$/, "") + 'widget.js" defer><\\/script>';</script>
`,
  );
  return { languages, words };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 && args[i + 1] ? args[i + 1]! : d;
  };
  const site = loadConfig(root);
  const only = site.languages?.length ? [...new Set([site.sourceLanguage ?? "en", ...site.languages])] : undefined;
  const res = await buildStatic(resolve(get("translations", "translations")), resolve(get("out", "public")), only, site.widget, site);
  console.log(
    `Built ${get("out", "public")}/: widget.js + ${res.languages.length} language(s)` +
      (res.languages.length
        ? ` — ${res.languages.map((l) => `${l.code} ${l.entries}${l.waitingForRetranslation ? ` (${l.waitingForRetranslation} outdated, shown until Pre-translate redoes them)` : ""}`).join(", ")}`
        : "") +
      (res.words.length ? `; word lookups: ${res.words.join(", ")}` : ""),
  );
}
