/**
 * Script-tag entry point. Paste into Framer → Site Settings → Custom Code (end of <body>):
 *
 *   <script src="https://YOUR-PONTE-HOST/widget.js"
 *           data-endpoint="https://YOUR-PONTE-HOST"
 *           data-languages="en,hi,ta,bn,es,fr,ja"
 *           data-source-language="en"
 *           defer></script>
 *
 * Optional attributes: data-content-type, data-position ("bottom-right" | "bottom-left" | "none"),
 * data-do-not-translate ("Ponte,ICICI Lombard"), data-notes.
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
      instance?: PonteController;
    };
  }
}

window.Ponte = { ...(window.Ponte ?? {}), createPonte, preferredLanguage, languages: LANGUAGES };

const script = document.currentScript as HTMLScriptElement | null;
if (script?.dataset.endpoint) {
  const d = script.dataset;
  const start = () => {
    const opts: PonteOptions = {
      endpoint: d.endpoint!,
      sourceLanguage: d.sourceLanguage,
      contentType: d.contentType as ContentType | undefined,
      doNotTranslate: d.doNotTranslate?.split(",").map((s) => s.trim()).filter(Boolean),
      notes: d.notes,
    };
    const ponte = createPonte(opts);
    window.Ponte!.instance = ponte;
    if (d.position !== "none") mountPicker(ponte, d.languages, d.sourceLanguage, d.position ?? "bottom-right");
    const pref = preferredLanguage();
    if (pref && pref !== d.sourceLanguage) void ponte.translate(pref);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}

function mountPicker(ponte: PonteController, languages: string | undefined, source: string | undefined, position: string) {
  const codes = languages?.split(",").map((s) => s.trim()) ?? LANGUAGES.map((l) => l.code);
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
