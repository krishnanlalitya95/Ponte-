/**
 * Build the static site that the widget reads in Static mode:
 *
 *   public/widget.js          the visitor widget
 *   public/t/<lang>.json      { "<text hash>": "<translation>" } for every saved translation
 *   public/t/index.json       which languages are published, with counts
 *   public/index.html         a small status page
 *
 *   npm run build:static -- --translations translations --out public
 *
 * The workflow "Publish translations" runs this and deploys public/ to GitHub Pages.
 */
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../src/core/languages.js";
import type { LanguageFile } from "../src/core/store.js";
import { textHash } from "../widget/engine.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface StaticBuildResult {
  languages: Array<{ code: string; name: string; entries: number }>;
}

export async function buildStatic(translationsDir: string, outDir: string): Promise<StaticBuildResult> {
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
    const data = JSON.parse(await readFile(join(translationsDir, f), "utf8")) as LanguageFile;
    const out: Record<string, string> = {};
    for (const e of Object.values(data)) {
      if (!e || typeof e.source !== "string" || typeof e.text !== "string") continue;
      // Same key the widget computes from the text it finds on the page.
      out[textHash(e.source.trim())] = e.text;
    }
    await writeFile(join(outDir, "t", `${code}.json`), JSON.stringify(out));
    languages.push({ code, name: lang.name, entries: Object.keys(out).length });
  }

  const updatedAt = new Date().toISOString();
  await writeFile(join(outDir, "t", "index.json"), JSON.stringify({ updatedAt, languages }, null, 2));
  await copyFile(join(root, "dist", "ponte-widget.js"), join(outDir, "widget.js"));
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
  return { languages };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 && args[i + 1] ? args[i + 1]! : d;
  };
  const res = await buildStatic(resolve(get("translations", "translations")), resolve(get("out", "public")));
  console.log(
    `Built ${get("out", "public")}/: widget.js + ${res.languages.length} language(s)` +
      (res.languages.length ? ` — ${res.languages.map((l) => `${l.code} ${l.entries}`).join(", ")}` : ""),
  );
}
