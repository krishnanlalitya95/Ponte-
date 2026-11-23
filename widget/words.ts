/**
 * Select a word → popup with a language dropdown and the word's meaning in that language:
 * what it means in this sentence, and its dictionary meanings.
 *
 * - Works on any language the page is shown in; the dropdown leaves that language out.
 * - Starts on Hindi (English when the page is shown in Hindi), then remembers the choice.
 * - Meanings were prepared by Pre-translate and published as t/words/<lang>.json; a
 *   language's file loads the first time a visitor needs it.
 */
import { LANGUAGES } from "../src/core/languages.js";
import type { PonteController } from "./engine.js";

/** [word as written in the original, matching words in this language, meaning here, dictionary] */
export type Gloss = [s: string, t: string, c: string, d: string];
export type WordFile = Record<string, Gloss[]>;

const PREF_KEY = "ponte:word-language";
const MAX_CHARS = 60;
const MAX_WORDS = 5;

const norm = (s: string) =>
  s
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "")
    .replace(/\s+/g, " ");

/**
 * The entry a selection refers to: exact match first, then the shortest entry containing
 * the selection, then the longest entry inside it. `field` 1 = words as shown in this
 * language, 0 = the original words.
 */
export function findGloss(list: Gloss[] | undefined, selected: string, field: 0 | 1): Gloss | undefined {
  const q = norm(selected);
  if (!list?.length || !q) return undefined;
  const items = list.filter((g) => norm(g[field]));
  const exact = items.find((g) => norm(g[field]) === q);
  if (exact) return exact;
  const wordIn = (hay: string, needle: string) => new RegExp(`(^|[^\\p{L}\\p{M}])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{M}])`, "u").test(hay);
  const containing = items.filter((g) => wordIn(norm(g[field]), q)).sort((a, b) => a[field].length - b[field].length)[0];
  if (containing) return containing;
  return items.filter((g) => wordIn(q, norm(g[field]))).sort((a, b) => b[field].length - a[field].length)[0];
}

/** Starting language for the dropdown: last choice, else Hindi, else English, else the first. */
export function defaultTarget(options: string[], remembered: string | null): string | undefined {
  if (remembered && options.includes(remembered)) return remembered;
  return ["hi", "en"].find((c) => options.includes(c)) ?? options[0];
}

export interface WordLookupOptions {
  ponte: PonteController;
  /** Where t/words/<lang>.json lives (the static base). */
  base: string;
  /** Languages with published word lookups. */
  languages: string[];
  /** The page's own language. */
  source: string;
  accent?: string;
}

export function mountWordLookup(o: WordLookupOptions): () => void {
  const files = new Map<string, Promise<WordFile>>();
  const load = (lang: string) => {
    let p = files.get(lang);
    if (!p) {
      p = fetch(`${o.base}/t/words/${lang}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<WordFile>) : {}))
        .catch(() => {
          files.delete(lang); // try again next time
          return {};
        });
      files.set(lang, p);
    }
    return p;
  };
  const nameOf = (code: string) => LANGUAGES.find((l) => l.code === code);
  const remembered = () => {
    try {
      return localStorage.getItem(PREF_KEY);
    } catch {
      return null;
    }
  };
  const remember = (code: string) => {
    try {
      localStorage.setItem(PREF_KEY, code);
    } catch {
      /* private mode */
    }
  };

  const host = document.createElement("div");
  host.setAttribute("data-ponte-skip", "");
  host.setAttribute("translate", "no");
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const a = o.accent ?? "#3A8D25";
  shadow.innerHTML = `
    <style>
      :host{all:initial}
      .p{position:fixed;z-index:2147483001;width:min(320px,calc(100vw - 24px));box-sizing:border-box;background:#fff;color:#1d1d1b;
         border-radius:14px;padding:12px 14px 14px;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
         box-shadow:0 1px 2px rgba(0,0,0,.08),0 8px 24px -4px rgba(0,0,0,.18);border:1px solid rgba(0,0,0,.08)}
      .p[hidden]{display:none}
      .hd{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin:0 0 10px}
      .q{margin:0;font-weight:600;font-size:15px;overflow-wrap:anywhere}
      .x{all:unset;cursor:pointer;width:28px;height:28px;margin:-4px -6px 0 0;display:grid;place-items:center;border-radius:8px;color:#6b6b66;flex:none}
      .x:hover{background:rgba(0,0,0,.05)}
      .x:focus-visible,select:focus-visible{outline:2px solid ${a};outline-offset:2px}
      .row{display:flex;align-items:center;gap:8px;margin:0 0 12px}
      .row label{color:#6b6b66;font-size:13px;flex:none}
      select{flex:1;min-width:0;font:inherit;font-size:14px;padding:6px 8px;border-radius:8px;border:1px solid rgba(0,0,0,.18);background:#fff;color:inherit}
      .lb{margin:0;font-size:11px;letter-spacing:.02em;text-transform:uppercase;color:#6b6b66}
      .c{margin:2px 0 10px;font-size:20px;line-height:1.35;font-weight:600;color:${a};overflow-wrap:anywhere}
      .d{margin:2px 0 0;font-size:15px;overflow-wrap:anywhere}
      .msg{margin:0;color:#6b6b66}
      @media (prefers-color-scheme: dark){
        .p{background:#1f1f1e;color:#f2f2ef;border-color:rgba(255,255,255,.12)}
        .x,.row label,.lb,.msg{color:#a9a9a3}
        select{background:#2a2a28;border-color:rgba(255,255,255,.2)}
      }
    </style>
    <div class="p" role="dialog" aria-label="Word translation" hidden>
      <div class="hd"><p class="q"></p><button class="x" type="button" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="row"><label for="ponte-wl">Translate to</label><select id="ponte-wl"></select></div>
      <div class="out" aria-live="polite"></div>
    </div>`;
  const pop = shadow.querySelector(".p") as HTMLElement;
  const title = shadow.querySelector(".q") as HTMLElement;
  const select = shadow.querySelector("select") as HTMLSelectElement;
  const out = shadow.querySelector(".out") as HTMLElement;

  let current: { key: string; selected: string; shown: string } | null = null;
  let anchor: DOMRect | null = null;
  let run = 0;
  let pointerInside = false;

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

  const place = () => {
    if (!anchor || pop.hidden) return;
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = Math.min(Math.max(12, anchor.left + anchor.width / 2 - w / 2), innerWidth - w - 12);
    // Below the selection (phones put their Copy menu above it); above if there's no room.
    let top = anchor.bottom + 12;
    if (top + h > innerHeight - 8 && anchor.top - h - 12 > 8) top = anchor.top - h - 12;
    pop.style.left = `${Math.max(12, left)}px`;
    pop.style.top = `${Math.max(8, Math.min(top, innerHeight - h - 8))}px`;
  };

  const close = () => {
    run++;
    current = null;
    pop.hidden = true;
  };

  const show = async () => {
    if (!current) return;
    const id = ++run;
    const { key, selected, shown } = current;
    const target = select.value;
    out.innerHTML = `<p class="msg">…</p>`;
    place();
    // Which word was selected: as it reads in the shown language, else in the original.
    let g = findGloss((await load(shown))[key], selected, 1);
    if (!g && shown !== o.source) g = findGloss((await load(o.source))[key], selected, 0);
    if (!g) g = findGloss((await load(target))[key], selected, 0);
    if (id !== run) return;
    if (!g) {
      out.innerHTML = `<p class="msg">No translation for this selection yet. Try a single word.</p>`;
      place();
      return;
    }
    const t = ((await load(target))[key] ?? []).find((x) => x[0] === g![0]);
    if (id !== run) return;
    if (!t) {
      out.innerHTML = `<p class="msg">No ${esc(nameOf(target)?.name ?? target)} translation for this word yet.</p>`;
      place();
      return;
    }
    // In the page's own language, the word as originally written is its meaning here.
    const here = target === o.source ? t[0] : t[2];
    out.innerHTML =
      `<p class="lb">In this sentence</p><p class="c" lang="${esc(target)}" dir="auto">${esc(here)}</p>` +
      (t[3] ? `<p class="lb">Dictionary</p><p class="d" lang="${esc(target)}" dir="auto">${esc(t[3])}</p>` : "");
    place();
  };

  const open = (key: string, selected: string, rect: DOMRect) => {
    const shown = o.ponte.language ?? o.source;
    const options = o.languages.filter((c) => c !== shown);
    if (!options.length) return;
    const prev = select.value;
    select.innerHTML = options
      .map((c) => `<option value="${esc(c)}" lang="${esc(c)}">${esc(nameOf(c)?.nativeName ?? c)}</option>`)
      .join("");
    select.value = options.includes(prev) && prev === remembered() ? prev : defaultTarget(options, remembered())!;
    title.textContent = `“${selected}”`;
    title.lang = shown;
    current = { key, selected, shown };
    anchor = rect;
    pop.hidden = false;
    void show();
  };

  select.addEventListener("change", () => {
    remember(select.value);
    void show();
  });
  shadow.querySelector(".x")!.addEventListener("click", close);
  // Using the popup moves focus away from the page, which can clear the selection: ignore that.
  shadow.addEventListener("pointerdown", () => (pointerInside = true));
  const release = () => setTimeout(() => (pointerInside = false), 0);
  shadow.addEventListener("pointerup", release);
  shadow.addEventListener("pointercancel", release);
  shadow.addEventListener("focusout", () => setTimeout(() => (pointerInside = shadow.activeElement !== null), 0));

  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    if (pointerInside || shadow.activeElement) return;
    const sel = getSelection();
    const text = sel?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !text) {
      if (current) close();
      return;
    }
    if (text.length > MAX_CHARS || text.split(" ").length > MAX_WORDS || !/\p{L}/u.test(text)) return close();
    const range = sel.getRangeAt(0);
    const info = o.ponte.lookup(range.commonAncestorContainer) ?? (sel.anchorNode ? o.ponte.lookup(sel.anchorNode) : null);
    if (!info) return close();
    if (current && current.key === info.key && current.selected === text) return;
    open(info.key, text, range.getBoundingClientRect());
  };
  const onSelection = () => {
    clearTimeout(timer);
    timer = setTimeout(check, 350); // wait until the visitor stops adjusting the selection
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && current) close();
  };
  const onDown = (e: PointerEvent) => {
    if (current && !e.composedPath().includes(host)) {
      // A tap elsewhere: close unless it starts a new selection (handled by selectionchange).
      setTimeout(() => {
        if (getSelection()?.isCollapsed !== false) close();
      }, 0);
    }
  };
  const onScroll = () => {
    if (!current) return;
    const sel = getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      anchor = sel.getRangeAt(0).getBoundingClientRect();
      place();
    }
  };
  const onLanguage = () => close();

  document.addEventListener("selectionchange", onSelection);
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onDown, true);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", place);
  window.addEventListener("ponte:language", onLanguage);

  return () => {
    clearTimeout(timer);
    document.removeEventListener("selectionchange", onSelection);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", place);
    window.removeEventListener("ponte:language", onLanguage);
    host.remove();
  };
}
