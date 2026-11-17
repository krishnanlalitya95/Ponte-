/**
 * Script-tag entry point. Paste into Framer → Site Settings → Custom Code (end of <body>).
 *
 * Static mode (free, no server) — translations published to GitHub Pages:
 *
 *   <script src="https://YOUR-NAME.github.io/Ponte-/widget.js" defer></script>
 *
 * Server mode (translates new text live):
 *
 *   <script src="https://YOUR-PONTE-HOST/widget.js" data-endpoint="https://YOUR-PONTE-HOST" defer></script>
 *
 * Optional attributes: data-languages="hi,ta,es" (default: every published language),
 * data-source-language="en", data-position ("bottom-right" | "bottom-left" | "none"),
 * data-fonts="off", data-static="…" (published translations elsewhere),
 * data-do-not-translate, data-content-type, data-notes (server mode).
 * Add data-ponte-skip to any element Ponte should leave alone.
 */
import { createPonte, preferredLanguage, type PonteController, type PonteOptions } from "./engine.js";
import { LANGUAGES } from "../src/core/languages.js";
import type { ContentType } from "../src/core/types.js";

declare global {
  interface Window {
    Ponte?: {
      createPonte: typeof createPonte;
      preferredLanguage: typeof preferredLanguage;
      languages: typeof LANGUAGES;
      /** Published languages for a static base (reads t/index.json). */
      publishedLanguages: typeof publishedLanguages;
      instance?: PonteController;
      /** URL this script was loaded from, minus "widget.js". */
      base?: string;
    };
  }
}

async function publishedLanguages(staticBase: string): Promise<string[]> {
  try {
    const r = await fetch(`${staticBase.replace(/\/+$/, "")}/t/index.json`);
    if (!r.ok) return [];
    const idx = (await r.json()) as { languages?: Array<{ code: string }> };
    return (idx.languages ?? []).map((l) => l.code);
  } catch {
    return [];
  }
}

const script = document.currentScript as HTMLScriptElement | null;
const scriptBase = script?.src ? script.src.replace(/[^/]*$/, "").replace(/\/+$/, "") : undefined;
window.Ponte = { ...(window.Ponte ?? {}), createPonte, preferredLanguage, publishedLanguages, languages: LANGUAGES, base: scriptBase };

// Auto-start unless the script was loaded by the Framer component (data-manual).
if (script && !script.hasAttribute("data-manual")) {
  const d = script.dataset;
  const endpoint = d.endpoint || undefined;
  // Static by default: translations sit next to widget.js, unless only a server was given.
  const staticBase = d.static || (endpoint ? undefined : scriptBase);
  const start = async () => {
    const opts: PonteOptions = {
      staticBase,
      endpoint,
      sourceLanguage: d.sourceLanguage,
      contentType: d.contentType as ContentType | undefined,
      doNotTranslate: d.doNotTranslate?.split(",").map((s) => s.trim()).filter(Boolean),
      notes: d.notes,
      fonts: d.fonts !== "off",
    };
    const ponte = createPonte(opts);
    window.Ponte!.instance = ponte;
    let codes = d.languages?.split(",").map((s) => s.trim()).filter(Boolean);
    if (!codes && staticBase && !endpoint) codes = await publishedLanguages(staticBase);
    if (d.position !== "none") mountPicker(ponte, codes?.length ? codes : undefined, d.sourceLanguage, d.position ?? "bottom-right");
    const pref = preferredLanguage();
    if (pref && pref !== d.sourceLanguage) void ponte.translate(pref);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void start());
  else void start();
}

function mountPicker(ponte: PonteController, languages: string[] | undefined, source: string | undefined, position: string) {
  const codes = languages ?? LANGUAGES.map((l) => l.code);
  const host = document.createElement("div");
  host.setAttribute("data-ponte-skip", "");
  host.style.cssText = `position:fixed;${position === "bottom-left" ? "left" : "right"}:16px;bottom:16px;z-index:2147483000;`;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .p{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:rgba(20,20,20,.88);
         color:#fff;font:500 13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.18);
         backdrop-filter:blur(8px)}
      select{appearance:none;background:transparent;color:inherit;border:0;font:inherit;cursor:pointer;padding-right:4px}
      select:focus-visible{outline:2px solid #8ab4ff;outline-offset:2px;border-radius:4px}
      option{color:#111}
      .s{opacity:.7;font-size:12px;min-width:0}
    </style>
    <div class="p" role="group" aria-label="Translate this page">
      <span aria-hidden="true">文A</span>
      <select aria-label="Language"></select>
      <span class="s" aria-live="polite"></span>
    </div>`;
  const select = shadow.querySelector("select")!;
  const statusEl = shadow.querySelector(".s")!;
  const original = document.createElement("option");
  original.value = "";
  original.textContent = "Original";
  select.append(original);
  for (const code of codes) {
    const lang = LANGUAGES.find((l) => l.code === code);
    if (!lang || code === source) continue;
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = lang.nativeName;
    select.append(opt);
  }
  select.value = ponte.language ?? "";
  select.addEventListener("change", () => {
    if (select.value) void ponte.translate(select.value);
    else ponte.restore();
  });
  window.addEventListener("ponte:status", (e) => {
    const s = (e as CustomEvent).detail as { state: string; language: string | null; failed?: number };
    select.value = s.language ?? "";
    statusEl.textContent =
      s.state === "translating" ? "Translating…" : s.state === "error" ? "Couldn't translate" : s.failed ? `${s.failed} left as is` : "";
  });
  document.body.append(host);
}
