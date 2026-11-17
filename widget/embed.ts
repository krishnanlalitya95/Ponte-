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
 * data-accent="#6F9C16" (picker colour; default from ponte.config.json → widget.accent),
 * data-fonts="off", data-auto="off" (don't switch to the visitor's device language),
 * data-static="…" (published translations elsewhere),
 * data-do-not-translate, data-content-type, data-notes (server mode).
 * Add data-ponte-skip to any element Ponte should leave alone.
 */
import { createPonte, initialLanguage, pageLanguage, preferredLanguage, type PonteController, type PonteOptions } from "./engine.js";
import { LANGUAGES } from "../src/core/languages.js";
import type { ContentType } from "../src/core/types.js";

declare global {
  interface Window {
    Ponte?: {
      createPonte: typeof createPonte;
      preferredLanguage: typeof preferredLanguage;
      initialLanguage: typeof initialLanguage;
      pageLanguage: typeof pageLanguage;
      languages: typeof LANGUAGES;
      /** Published languages for a static base (reads t/index.json). */
      publishedLanguages: typeof publishedLanguages;
      instance?: PonteController;
      /** URL this script was loaded from, minus "widget.js". */
      base?: string;
    };
  }
}

interface PublishedIndex {
  languages: string[];
  widget: { accent?: string; position?: string; autoDetect?: boolean };
}

const indexCache = new Map<string, Promise<PublishedIndex>>();

/** Published languages (in your order) and picker look, from t/index.json. */
function publishedIndex(staticBase: string): Promise<PublishedIndex> {
  const base = staticBase.replace(/\/+$/, "");
  let p = indexCache.get(base);
  if (!p) {
    p = fetch(`${base}/t/index.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((idx: { languages?: Array<{ code: string }>; widget?: PublishedIndex["widget"] }) => ({
        languages: (idx.languages ?? []).map((l) => l.code),
        widget: idx.widget ?? {},
      }))
      .catch(() => ({ languages: [], widget: {} }));
    indexCache.set(base, p);
  }
  return p;
}

async function publishedLanguages(staticBase: string): Promise<string[]> {
  return (await publishedIndex(staticBase)).languages;
}

const script = document.currentScript as HTMLScriptElement | null;
const scriptBase = script?.src ? script.src.replace(/[^/]*$/, "").replace(/\/+$/, "") : undefined;
window.Ponte = { ...(window.Ponte ?? {}), createPonte, preferredLanguage, initialLanguage, pageLanguage, publishedLanguages, languages: LANGUAGES, base: scriptBase };

// Auto-start unless the script was loaded by the Framer component (data-manual).
if (script && !script.hasAttribute("data-manual")) {
  const d = script.dataset;
  const endpoint = d.endpoint || undefined;
  // Static by default: translations sit next to widget.js, unless only a server was given.
  const staticBase = d.static || (endpoint ? undefined : scriptBase);
  const start = async () => {
    const source = pageLanguage(d.sourceLanguage);
    const opts: PonteOptions = {
      staticBase,
      endpoint,
      sourceLanguage: source,
      contentType: d.contentType as ContentType | undefined,
      doNotTranslate: d.doNotTranslate?.split(",").map((s) => s.trim()).filter(Boolean),
      notes: d.notes,
      fonts: d.fonts !== "off",
    };
    const ponte = createPonte(opts);
    window.Ponte!.instance = ponte;
    let codes = d.languages?.split(",").map((s) => s.trim()).filter(Boolean);
    const published = staticBase ? await publishedIndex(staticBase) : null;
    if (!codes && published && !endpoint) codes = published.languages;
    const accent = d.accent || published?.widget.accent;
    const position = d.position ?? published?.widget.position ?? "bottom-right";
    if (position !== "none") mountPicker(ponte, codes?.length ? codes : undefined, source, position, accent);
    // Visitor's choice, else their device language if we've published it (data-auto="off" to disable).
    const first = initialLanguage({
      available: codes ?? LANGUAGES.map((l) => l.code),
      source,
      // Off unless switched on: data-auto="on", or widget.autoDetect in ponte.config.json.
      auto: d.auto ? d.auto !== "off" : published?.widget.autoDetect === true,
    });
    if (first) void ponte.translate(first);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void start());
  else void start();
}

const ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;

/** "#6F9C16" → "111, 156, 22" for rgba(). Falls back to a neutral ink. */
function rgb(hex: string | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return "17, 17, 17";
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** "日本語 · Japanese" so people who can't read a script still find it; just "English" for English. */
export function optionLabel(code: string): string {
  const lang = LANGUAGES.find((l) => l.code === code);
  if (!lang) return code;
  return lang.nativeName === lang.name ? lang.name : `${lang.nativeName} · ${lang.name}`;
}

function mountPicker(
  ponte: PonteController,
  languages: string[] | undefined,
  source: string,
  position: string,
  accent?: string,
) {
  // The page's language first, then every other offered language. No separate "Original":
  // the page language shows selected while the page is as written.
  const codes = [source, ...(languages ?? LANGUAGES.map((l) => l.code)).filter((c) => c !== source)];
  const a = rgb(accent);
  const host = document.createElement("div");
  host.setAttribute("data-ponte-skip", "");
  const side = position === "bottom-left" ? "left" : "right";
  host.style.cssText = `position:fixed;${side}:calc(16px + env(safe-area-inset-${side}, 0px));bottom:calc(16px + env(safe-area-inset-bottom, 0px));z-index:2147483000;`;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host{all:initial}
      .b{position:relative;width:52px;height:52px;border-radius:50%;background:#fff;color:rgb(${a});
         display:grid;place-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent;
         box-shadow:
           0 0 0 1px rgba(${a},.10),
           0 1px 2px rgba(${a},.14),
           0 4px 8px -2px rgba(${a},.18),
           0 12px 24px -6px rgba(${a},.28),
           0 24px 44px -12px rgba(${a},.22);
         transition:transform .18s cubic-bezier(.2,.8,.2,1), box-shadow .18s ease}
      .b:hover{transform:translateY(-2px);
         box-shadow:0 0 0 1px rgba(${a},.12),0 2px 3px rgba(${a},.14),0 6px 12px -2px rgba(${a},.20),0 16px 30px -6px rgba(${a},.30),0 30px 52px -12px rgba(${a},.24)}
      .b:active{transform:translateY(0) scale(.96)}
      .b:focus-within{outline:2px solid rgba(${a},.55);outline-offset:3px}
      svg{display:block;pointer-events:none}
      select{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;
             appearance:none;-webkit-appearance:none;border:0;border-radius:50%;font-size:16px;color:#111}
      .b.busy::after{content:"";position:absolute;inset:-3px;border-radius:50%;
             border:2px solid rgba(${a},.18);border-top-color:rgb(${a});animation:spin .8s linear infinite;pointer-events:none}
      @keyframes spin{to{transform:rotate(360deg)}}
      @media (prefers-reduced-motion:reduce){.b,.b:hover{transition:none;transform:none}.b.busy::after{animation-duration:2.4s}}
      .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
    </style>
    <div class="b" title="Translate">
      ${ICON}
      <select></select>
      <span class="sr" aria-live="polite"></span>
    </div>`;
  const btn = shadow.querySelector(".b") as HTMLElement;
  const select = shadow.querySelector("select")!;
  const live = shadow.querySelector(".sr")!;
  for (const code of codes) {
    if (!LANGUAGES.some((l) => l.code === code)) continue;
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = optionLabel(code);
    select.append(opt);
  }
  const label = (code: string) => {
    const name = LANGUAGES.find((l) => l.code === code)?.name ?? code;
    select.setAttribute("aria-label", `Translate this page. Current language: ${name}`);
    btn.title = `Translate · ${name}`;
  };
  select.value = ponte.language ?? source;
  label(select.value);
  select.addEventListener("change", () => void ponte.translate(select.value));
  window.addEventListener("ponte:status", (e) => {
    const s = (e as CustomEvent).detail as { state: string; language: string | null };
    select.value = s.language ?? source;
    label(select.value);
    btn.classList.toggle("busy", s.state === "translating");
    live.textContent = s.state === "translating" ? "Translating…" : s.state === "error" ? "Couldn't translate this page" : "";
  });
  document.body.append(host);
}
