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
  widget: { accent?: string; position?: string; autoDetect?: boolean; callout?: Callout; about?: AboutLink };
}

/** Last item in the language list, linking to the story of how Ponte was made. */
export interface AboutLink {
  title?: string;
  text?: string;
  linkLabel?: string;
  url?: string;
}

/** The green note that opens around the picker on landing. */
export interface Callout {
  enabled?: boolean;
  title?: string;
  text?: string;
  linkLabel?: string;
  linkUrl?: string;
  /** Wait this long after the page loads before opening (ms). */
  delayMs?: number;
  /** Close on its own after this long (ms), unless the visitor is hovering or focused in it. */
  showForMs?: number;
  /** "session" (default): once per browser session; "always": every page load. */
  frequency?: "session" | "always";
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
    if (position !== "none") {
      const callout = d.callout === "off" ? undefined : published?.widget.callout;
      const about = published?.widget.about ?? (callout?.linkUrl ? { url: callout.linkUrl } : undefined);
      mountPicker(ponte, codes?.length ? codes : undefined, source, position, accent, callout, about);
    }
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

const ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;

/**
 * A shade of the accent dark enough for white text to pass WCAG AA (4.5:1),
 * keeping its hue. The accent itself is used when it already passes.
 */
export function readableOn(hex: string | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return "17, 17, 17";
  const n = parseInt(m[1]!, 16);
  let c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (v: number[]) =>
    v.map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }).reduce((acc, x, i) => acc + x * [0.2126, 0.7152, 0.0722][i]!, 0);
  for (let i = 0; i < 20 && 1.05 / (lum(c) + 0.05) < 4.5; i++) c = c.map((x) => Math.round(x * 0.94));
  return c.join(", ");
}

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
  if (lang.nativeName === lang.name) return lang.name;
  // Start with a left-to-right mark so Arabic/Urdu labels don't flip the whole line
  // ("Arabic · العربية"); the native name still comes first.
  return `${lang.rtl ? "\u200E" : ""}${lang.nativeName} · ${lang.name}`;
}

const CHECK = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

function mountPicker(
  ponte: PonteController,
  languages: string[] | undefined,
  source: string,
  position: string,
  accent?: string,
  callout?: Callout,
  about?: AboutLink,
) {
  // The page's language first, then every other offered language. No separate "Original":
  // the page language shows selected while the page is as written.
  const codes = [source, ...(languages ?? LANGUAGES.map((l) => l.code)).filter((c) => c !== source)].filter((c) =>
    LANGUAGES.some((l) => l.code === c),
  );
  const a = rgb(accent);
  const cardBg = readableOn(accent);
  const host = document.createElement("div");
  host.setAttribute("data-ponte-skip", "");
  const side = position === "bottom-left" ? "left" : "right";
  host.style.cssText = `position:fixed;${side}:calc(16px + env(safe-area-inset-${side}, 0px));bottom:calc(16px + env(safe-area-inset-bottom, 0px));z-index:2147483000;`;
  const shadow = host.attachShadow({ mode: "open" });
  const font = `var(--ponte-font, system-ui,-apple-system,"Segoe UI",Roboto,sans-serif)`;
  shadow.innerHTML = `
    <style>
      :host{all:initial}
      *{box-sizing:border-box}
      .b{position:relative;z-index:2;width:48px;height:36px;border-radius:16px;border:0;padding:0;margin:0;background:#fff;color:rgb(${a});
         display:grid;place-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent;
         box-shadow:
           0 1px 2px rgba(${a},.14),
           0 4px 8px -2px rgba(${a},.18),
           0 12px 24px -6px rgba(${a},.28),
           0 24px 44px -12px rgba(${a},.22);
         transition:transform .18s cubic-bezier(.2,.8,.2,1), box-shadow .18s ease}
      .b::before{content:"";position:absolute;inset:-6px}
      .b:hover{transform:translateY(-2px);
         box-shadow:0 2px 3px rgba(${a},.14),0 6px 12px -2px rgba(${a},.20),0 16px 30px -6px rgba(${a},.30),0 30px 52px -12px rgba(${a},.24)}
      .b:active{transform:translateY(0) scale(.96)}
      .b:focus-visible{outline:2px solid rgba(${a},.55);outline-offset:3px}
      svg{display:block;pointer-events:none;flex:none}
      .b.busy svg{animation:pulse 1s ease-in-out infinite}
      @keyframes pulse{50%{opacity:.3}}
      .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

      /* Language menu */
      .m{position:absolute;${side}:0;bottom:48px;width:min(300px, calc(100vw - 32px));max-height:min(560px, calc(100vh - 120px));
         display:flex;flex-direction:column;background:#fff;border-radius:20px;overflow:hidden;
         font:400 15px/1.3 ${font};color:#1a1a1a;-webkit-font-smoothing:antialiased;
         box-shadow:0 0 0 1px rgba(0,0,0,.04),0 2px 4px rgba(${a},.10),0 12px 28px -6px rgba(${a},.24),0 32px 64px -16px rgba(${a},.28);
         transform-origin:${side === "right" ? "calc(100% - 24px)" : "24px"} 100%;
         opacity:0;transform:translateY(8px) scale(.96);visibility:hidden;pointer-events:none;
         transition:opacity .16s ease, transform .22s cubic-bezier(.2,.9,.25,1), visibility 0s linear .22s}
      .m.open{opacity:1;transform:none;visibility:visible;pointer-events:auto;transition:opacity .16s ease, transform .22s cubic-bezier(.2,.9,.25,1), visibility 0s}
      .list{list-style:none;margin:0;padding:6px;overflow-y:auto;overscroll-behavior:contain;outline:none}
      .o{display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:12px;cursor:pointer;-webkit-tap-highlight-color:transparent}
      .o .t{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
      .o .n{font-size:15px;text-align:left;unicode-bidi:isolate}
      .o .e{font-size:12px;color:#7a7a7a}
      .o .k{color:rgb(${a});visibility:hidden}
      .o[aria-selected="true"] .k{visibility:visible}
      .o[aria-selected="true"] .n{font-weight:600}
      .o:hover,.o.active{background:rgba(${a},.08)}
      .about{display:block;margin:0;padding:14px 16px 16px;border-top:1px solid rgba(0,0,0,.07);
         text-decoration:none;color:inherit;background:rgba(${a},.05);-webkit-tap-highlight-color:transparent}
      .about:hover{background:rgba(${a},.10)}
      .about:focus-visible{outline:2px solid rgba(${a},.55);outline-offset:-4px;border-radius:0 0 20px 20px}
      .about .t{flex:1;min-width:0}
      .about strong{display:block;font-size:13px;font-weight:600;color:rgb(${cardBg});margin-bottom:2px}
      .about span{display:block;font-size:12px;line-height:1.45;color:#5f5f5f}
      .about .cta{display:inline-flex;align-items:center;gap:6px;margin-top:10px;font-size:13px;font-weight:600;color:rgb(${cardBg})}
      .about .cta i{font-style:normal;display:inline-block;transition:transform .18s ease}
      .about:hover .cta i{transform:translateX(3px)}

      /* Callout: grows out of the button, which sits in its bottom-${side} corner. */
      .c{position:absolute;${side}:-10px;bottom:-10px;width:min(320px, calc(100vw - 12px));
         padding:18px 18px 58px;border-radius:24px;background:rgb(${cardBg});color:#fff;
         font:400 14px/1.45 ${font};-webkit-font-smoothing:antialiased;
         box-shadow:0 2px 4px rgba(${a},.18),0 12px 28px -6px rgba(${a},.40),0 32px 60px -16px rgba(${a},.35);
         transform-origin:${side === "right" ? "calc(100% - 34px)" : "34px"} calc(100% - 28px);
         opacity:0;transform:scale(.4);visibility:hidden;pointer-events:none;
         transition:opacity .22s ease, transform .32s cubic-bezier(.2,.9,.25,1.1), visibility 0s linear .32s}
      .c.open{opacity:1;transform:none;visibility:visible;pointer-events:auto;
         transition:opacity .22s ease, transform .38s cubic-bezier(.2,.9,.25,1.1), visibility 0s}
      .c h2{margin:0 0 6px;font-size:16px;line-height:1.3;font-weight:600;letter-spacing:-.01em}
      .c p{margin:0;color:rgba(255,255,255,.92)}
      .c a{position:absolute;${side === "right" ? "left" : "right"}:18px;bottom:18px;display:inline-flex;align-items:center;gap:6px;
         color:#fff;font-weight:600;text-decoration:none;border-radius:8px;padding:2px 0}
      .c a:hover span{transform:translateX(3px)}
      .c a span{display:inline-block;transition:transform .18s ease}
      .c a:focus-visible{outline:2px solid #fff;outline-offset:3px}
      @media (prefers-reduced-motion:reduce){
        .b,.b:hover{transition:none;transform:none}.b.busy svg{animation-duration:2.4s}
        .m,.m.open,.c,.c.open{transition:opacity .15s ease, visibility 0s linear .15s;transform:none}}
    </style>
    ${callout?.enabled ? `<div class="c" role="note" aria-label="${esc(callout.title ?? "About this translator")}">
      ${callout.title ? `<h2>${esc(callout.title)}</h2>` : ""}
      ${callout.text ? `<p>${esc(callout.text)}</p>` : ""}
      ${callout.linkUrl ? `<a href="${esc(callout.linkUrl)}">${esc(callout.linkLabel ?? "View case study")} <span aria-hidden="true">→</span></a>` : ""}
    </div>` : ""}
    <div class="m" id="ponte-menu">
      <ul class="list" role="listbox" tabindex="-1" aria-label="Choose a language">
        ${codes
          .map((code) => {
            const l = LANGUAGES.find((x) => x.code === code)!;
            const english = l.nativeName === l.name ? "" : `<span class="e">${esc(l.name)}</span>`;
            return `<li class="o" role="option" id="ponte-o-${code}" data-code="${code}" aria-selected="false" lang="${code}">
              <span class="t"><span class="n" dir="auto">${esc(l.nativeName)}</span>${english}</span>
              <span class="k">${CHECK}</span></li>`;
          })
          .join("")}
      </ul>
      ${about?.url ? `<a class="about" href="${esc(about.url)}">
        <strong>${esc(about.title ?? "About Ponte")}</strong>
        <span>${esc(about.text ?? "An AI agent I built that translates with context, carrying meaning, tone and poetry across, not just words.")}</span>
        <b class="cta">${esc(about.linkLabel ?? "View case study")} <i aria-hidden="true">→</i></b></a>` : ""}
    </div>
    <button class="b" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="ponte-menu">
      ${ICON}
      <span class="sr" aria-live="polite"></span>
    </button>`;
  const btn = shadow.querySelector(".b") as HTMLButtonElement;
  const menu = shadow.querySelector(".m") as HTMLElement;
  const list = shadow.querySelector(".list") as HTMLElement;
  const options = [...shadow.querySelectorAll<HTMLElement>(".o")];
  const live = shadow.querySelector(".sr")!;
  let current = ponte.language ?? source;
  let active = 0;

  const label = () => {
    const name = LANGUAGES.find((l) => l.code === current)?.name ?? current;
    btn.setAttribute("aria-label", `Translate this page. Current language: ${name}`);
    btn.title = `Translate · ${name}`;
    for (const o of options) o.setAttribute("aria-selected", String(o.dataset.code === current));
  };
  const setActive = (i: number) => {
    active = (i + options.length) % options.length;
    options.forEach((o, j) => o.classList.toggle("active", j === active));
    list.setAttribute("aria-activedescendant", options[active]!.id);
    options[active]!.scrollIntoView({ block: "nearest" });
  };
  const isOpen = () => menu.classList.contains("open");
  const open = () => {
    if (isOpen()) return;
    host.dispatchEvent(new CustomEvent("ponte:menu-open"));
    menu.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    setActive(Math.max(0, options.findIndex((o) => o.dataset.code === current)));
    list.focus({ preventScroll: true });
    document.addEventListener("pointerdown", onOutside, true);
  };
  const close = (refocus = false) => {
    menu.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    options.forEach((o) => o.classList.remove("active"));
    document.removeEventListener("pointerdown", onOutside, true);
    if (refocus) btn.focus();
  };
  const choose = (code: string | undefined) => {
    if (!code) return;
    close(true);
    if (code !== current) {
      current = code;
      label();
      void ponte.translate(code);
    }
  };
  const onOutside = (e: Event) => {
    if (!e.composedPath().includes(host)) close();
  };

  btn.addEventListener("click", () => (isOpen() ? close() : open()));
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      open();
    }
  });
  for (const o of options) {
    o.addEventListener("click", () => choose(o.dataset.code));
    o.addEventListener("pointermove", () => setActive(options.indexOf(o)));
  }
  menu.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") setActive(active + 1);
    else if (e.key === "ArrowUp") setActive(active - 1);
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(options.length - 1);
    else if (e.key === "Enter" || e.key === " ") {
      if (e.target === list) choose(options[active]?.dataset.code);
      else return;
    } else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") {
      // Let Tab reach the About link; Tab past it (or Shift+Tab out) closes.
      const aboutLink = shadow.querySelector(".about");
      if (!aboutLink || e.target === aboutLink || e.shiftKey) close();
      return;
    } else return;
    e.preventDefault();
  });

  label();
  window.addEventListener("ponte:status", (e) => {
    const s = (e as CustomEvent).detail as { state: string; language: string | null };
    current = s.language ?? source;
    label();
    btn.classList.toggle("busy", s.state === "translating");
    live.textContent = s.state === "translating" ? "Translating…" : s.state === "error" ? "Couldn't translate this page" : "";
  });
  document.body.append(host);
  // Use the site's own typeface (first paragraph's font), so the menu and note feel native.
  const sample = document.querySelector("main p, p, h1") ?? document.body;
  const family = getComputedStyle(sample).fontFamily;
  if (family) host.style.setProperty("--ponte-font", `${family}, system-ui, sans-serif`);
  if (callout?.enabled) wireCallout(host, shadow, btn, callout);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const CALLOUT_SEEN = "ponte:callout-seen";

/** Open on landing, close by itself, on a tap outside, on Escape, or when the picker is used. */
function wireCallout(host: HTMLElement, shadow: ShadowRoot, trigger: HTMLElement, cfg: Callout) {
  const card = shadow.querySelector(".c") as HTMLElement | null;
  if (!card) return;
  if (cfg.frequency !== "always") {
    try {
      if (sessionStorage.getItem(CALLOUT_SEEN)) return;
    } catch {
      /* storage unavailable: show it */
    }
  }
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let hovering = false;
  const close = () => {
    card.classList.remove("open");
    clearTimeout(hideTimer);
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const scheduleClose = (ms: number) => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (hovering ? scheduleClose(1500) : close()), ms);
  };
  const onOutside = (e: Event) => {
    if (!e.composedPath().includes(host)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  card.addEventListener("pointerenter", () => (hovering = true));
  card.addEventListener("pointerleave", () => (hovering = false));
  card.addEventListener("focusin", () => (hovering = true));
  card.addEventListener("focusout", () => (hovering = false));
  // Using the picker means they've got it: get out of the way.
  trigger.addEventListener("pointerdown", close);
  host.addEventListener("ponte:menu-open", close);

  setTimeout(() => {
    card.classList.add("open");
    try {
      sessionStorage.setItem(CALLOUT_SEEN, "1");
    } catch {
      /* fine */
    }
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    scheduleClose(cfg.showForMs ?? 9000);
  }, cfg.delayMs ?? 2000);
}
