/**
 * Ponte visitor engine — runs in the browser.
 *
 * Finds plain text on the page, sends it to Ponte with page context, and swaps
 * each text node's content in place. Originals are kept so the page can be
 * restored, and a MutationObserver re-applies translations when Framer
 * re-renders (page transitions, variants, lazy sections).
 */
import type { ContentType, SegmentResult, TranslateResponse } from "../src/core/types.js";
import { fontFor, loadFont } from "./fonts.js";

export interface PonteOptions {
  /**
   * Static mode: base URL where published translations live (…/t/<lang>.json).
   * No server needed; text without a saved translation stays in the original language.
   */
  staticBase?: string;
  /**
   * Ponte server, e.g. "http://localhost:8787". With staticBase set too, it's only asked
   * for text that isn't published yet.
   */
  endpoint?: string;
  /** Load a matching Noto font for non-Latin scripts. Default true. */
  fonts?: boolean;
  /** Element to translate. Defaults to document.body. */
  root?: Element;
  contentType?: ContentType;
  /** Language the page is written in, if known (skips detection for obvious cases). */
  sourceLanguage?: string;
  doNotTranslate?: string[];
  glossary?: Record<string, string>;
  notes?: string;
  /** Watch for new/changed text and translate it too. Default true. */
  observe?: boolean;
  /** Remember the visitor's choice in localStorage. Default true. */
  remember?: boolean;
  /**
   * Keep a copy of translations in the visitor's browser so a return visit shows them
   * instantly, then quietly checks the server for updates. Default true.
   */
  persist?: boolean;
  onStatus?: (s: PonteStatus) => void;
  /**
   * Animates a language switch the visitor asked for (translate(lang, { animate: true })).
   * Gets the affected blocks and a `swap` that puts the new text in; must call it right away.
   * Read when a switch happens, so it can be set after createPonte.
   */
  transition?: (blocks: Element[], swap: () => void) => void;
}

export interface PonteStatus {
  state: "idle" | "translating" | "done" | "error";
  language: string | null;
  translated?: number;
  failed?: number;
  /** Static mode: blocks with no published translation yet (left in the original). */
  missing?: number;
  error?: string;
}

export interface PonteController {
  /** `animate`: play the switch transition (for picks from the menu, not page loads). */
  translate(language: string, options?: { animate?: boolean }): Promise<void>;
  restore(): void;
  readonly language: string | null;
  destroy(): void;
}

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "INPUT", "SELECT", "OPTION",
  "CODE", "PRE", "KBD", "SAMP", "SVG", "MATH", "CANVAS", "IFRAME",
]);
const INLINE_TAGS = new Set([
  "A", "SPAN", "STRONG", "EM", "B", "I", "U", "S", "SMALL", "MARK", "SUB", "SUP",
  "ABBR", "CITE", "Q", "TIME", "DFN", "BDI", "BDO", "FONT", "DEL", "INS", "WBR", "BR",
]);
const TEXT_CONTAINERS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "FIGCAPTION", "LABEL", "DT", "DD",
  "TD", "TH", "CAPTION", "BUTTON", "SUMMARY", "LEGEND",
]);
const SKIP_SELECTOR = '[data-ponte-skip], [translate="no"], .notranslate, [contenteditable="true"]';
const RTL = new Set(["ar", "ur", "he", "fa"]);
const NO_SPACE = new Set(["ja", "zh"]);
const STORAGE_KEY = "ponte:language";
const PERSIST_PREFIX = "ponte:t:";
const BATCH_SEGMENTS = 120;
const BATCH_CHARS = 16000;

interface Piece {
  node: Text;
  lead: string;
  core: string;
  trail: string;
}

interface Block {
  id: string;
  el: Element;
  pieces: Piece[];
  /** Text sent to Ponte; contains ⟦n⟧ markers when the block has several text nodes. */
  text: string;
  /** Whether there was whitespace between piece i and i+1 in the original. */
  gaps: boolean[];
}

export function createPonte(opts: PonteOptions): PonteController {
  const endpoint = opts.endpoint ? opts.endpoint.replace(/\/+$/, "") : null;
  const staticBase = opts.staticBase ? opts.staticBase.replace(/\/+$/, "") : null;
  if (!endpoint && !staticBase) throw new Error("Ponte needs staticBase or endpoint");
  const published = new Map<string, Promise<Record<string, string>>>(); // lang → { textHash: translation }
  const fontTouched = new Map<HTMLElement, string>(); // element → its previous inline font-family
  const root = opts.root ?? document.body;
  const originals = new WeakMap<Text, string>(); // source text per node
  const written = new WeakMap<Text, string>(); // what Ponte last wrote, to spot external changes
  const blockIds = new WeakMap<Element, string>();
  const dirTouched = new Set<Element>();
  const cache = new Map<string, string>(); // `${lang}\0${text}` → translation
  const failed = new Set<string>(); // `${lang}\0${text}` that Ponte couldn't translate; not retried automatically
  let idCounter = 0;
  let language: string | null = null;
  let generation = 0;
  let observer: MutationObserver | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let applying = false;
  const persisted = new Map<string, Record<string, string>>(); // lang → { textHash: translation }
  let persistTimer: ReturnType<typeof setTimeout> | undefined;

  function persistedFor(lang: string): Record<string, string> {
    let m = persisted.get(lang);
    if (!m) {
      m = {};
      if (opts.persist !== false) {
        try {
          const raw = localStorage.getItem(PERSIST_PREFIX + lang);
          if (raw) m = JSON.parse(raw) as Record<string, string>;
        } catch {
          /* storage unavailable or corrupt */
        }
      }
      persisted.set(lang, m);
    }
    return m;
  }

  function savePersisted() {
    if (opts.persist === false) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      for (const [lang, m] of persisted) {
        try {
          localStorage.setItem(PERSIST_PREFIX + lang, JSON.stringify(m));
        } catch {
          /* quota or private mode: fine, the server copy still works */
        }
      }
    }, 200);
  }

  const status = (s: PonteStatus) => {
    document.documentElement.setAttribute("data-ponte-state", s.state);
    opts.onStatus?.(s);
    window.dispatchEvent(new CustomEvent("ponte:status", { detail: s }));
  };

  function sourceOf(node: Text): string {
    const current = node.nodeValue ?? "";
    const w = written.get(node);
    if (w !== undefined && w === current) return originals.get(node) ?? current; // showing our translation
    // First sighting, or the page itself changed the text since we wrote it.
    originals.set(node, current);
    written.delete(node);
    return current;
  }

  function blockFor(el: Element): Element {
    const marked = el.closest("[data-ponte-id]");
    if (marked && root.contains(marked)) return marked;
    // Climb through inline wrappers (a, span, strong…) to the first block-level ancestor.
    let cur: Element = el;
    let child: Element = el;
    while (INLINE_TAGS.has(cur.tagName) && cur.parentElement && cur !== root) {
      child = cur;
      cur = cur.parentElement;
    }
    if (cur === el) return el;
    // Merge inline pieces into one sentence only when the block really is running text:
    // a paragraph-like element, or one with its own words between the inline bits.
    // Otherwise (nav > a, a > a) each inline child is its own item.
    const hasOwnText = Array.from(cur.childNodes).some((n) => n.nodeType === 3 && (n.nodeValue ?? "").trim());
    return hasOwnText || TEXT_CONTAINERS.has(cur.tagName) ? cur : child;
  }

  function idFor(block: Element): string {
    const explicit = block.getAttribute("data-ponte-id");
    if (explicit) return explicit;
    let id = blockIds.get(block);
    if (!id) {
      id = `b${++idCounter}`;
      blockIds.set(block, id);
    }
    return id;
  }

  function collect(scope: Node = root): Block[] {
    const byBlock = new Map<Element, Piece[]>();
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const parent = n.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName) || parent.closest("svg")) return NodeFilter.FILTER_REJECT;
        if (parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
        if (!(n.nodeValue ?? "").trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const node = n as Text;
      const src = sourceOf(node);
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(src)!;
      const block = blockFor(node.parentElement!);
      const list = byBlock.get(block) ?? [];
      list.push({ node, lead: m[1] ?? "", core: m[2] ?? "", trail: m[3] ?? "" });
      byBlock.set(block, list);
    }

    const blocks: Block[] = [];
    for (const [el, pieces] of byBlock) {
      const gaps = pieces.slice(0, -1).map((p, i) => !!(p.trail || pieces[i + 1]!.lead));
      const text =
        pieces.length === 1
          ? pieces[0]!.core
          : pieces.map((p, i) => `⟦${i}⟧${p.core}${gaps[i] ? " " : ""}`).join("");
      blocks.push({ id: idFor(el), el, pieces, text, gaps });
    }
    return blocks;
  }

  function roleOf(el: Element): string {
    const tag = el.tagName.toLowerCase();
    const where = el.closest("nav") ? " in nav" : el.closest("footer") ? " in footer" : el.closest("header") ? " in header" : "";
    const btn = el.closest("button, [role=button]") ? "button" : "";
    return (btn || tag) + where;
  }

  function groupOf(el: Element): string | undefined {
    const sec = el.closest("section, article, [data-framer-name]");
    return sec?.getAttribute("data-framer-name") ?? sec?.id ?? undefined;
  }

  function apply(block: Block, translation: string, lang: string) {
    applying = true;
    try {
      if (block.pieces.length === 1) {
        const p = block.pieces[0]!;
        write(p.node, p.lead + translation + p.trail);
      } else {
        const parts = splitMarkers(translation, block.pieces.length);
        if (!parts) {
          // Markers lost: put the whole translation in the first node, empty the rest.
          block.pieces.forEach((p, i) => write(p.node, i === 0 ? p.lead + translation.replace(/⟦\d+⟧/g, "") + p.trail : ""));
        } else {
          const n = block.pieces.length;
          const cores = parts.map((x) => x.trim());
          // Space between DOM-adjacent pieces i and i+1: where the translation puts one, or where
          // the original had one (except in languages written without spaces).
          const side: Array<"start" | "end" | null> = [];
          for (let i = 0; i < n - 1; i++) {
            const inTranslation = /\s$/.test(parts[i] ?? "") || /^\s/.test(parts[i + 1] ?? "");
            const want = (inTranslation || (block.gaps[i] && !NO_SPACE.has(lang))) && !!cores[i] && !!cores[i + 1];
            if (!want) side.push(null);
            // Keep the space on the side it was originally (outside a link/bold), else where the translation had it.
            else if (block.gaps[i]) side.push(block.pieces[i]!.trail ? "end" : "start");
            else side.push(/^\s/.test(parts[i + 1] ?? "") ? "start" : "end");
          }
          block.pieces.forEach((p, i) => {
            const lead = i === 0 ? p.lead : side[i - 1] === "start" ? " " : "";
            const trail = i === n - 1 ? p.trail : side[i] === "end" ? " " : "";
            write(p.node, lead + cores[i] + trail);
          });
        }
      }
      applyFont(block, lang);
      if (RTL.has(lang)) {
        if (!block.el.hasAttribute("dir")) {
          block.el.setAttribute("dir", "rtl");
          dirTouched.add(block.el);
        }
      } else if (dirTouched.has(block.el)) {
        block.el.removeAttribute("dir");
        dirTouched.delete(block.el);
      }
    } finally {
      observer?.takeRecords();
      applying = false;
    }
  }

  /** Add a matching Noto font after each element's own font (see fonts.ts). */
  function applyFont(block: Block, lang: string) {
    if (opts.fonts === false || typeof getComputedStyle !== "function") return;
    for (const p of block.pieces) {
      const el = p.node.parentElement;
      if (!el) continue;
      const before = fontTouched.has(el) ? fontTouched.get(el)! : el.style.fontFamily;
      if (fontTouched.has(el)) el.style.fontFamily = before; // measure the element's own font
      const own = getComputedStyle(el).fontFamily || "";
      const noto = fontFor(lang, own);
      if (!noto) {
        if (fontTouched.has(el)) fontTouched.delete(el);
        continue;
      }
      loadFont(noto);
      if (!fontTouched.has(el)) fontTouched.set(el, before);
      el.style.fontFamily = withScriptFont(own, noto);
    }
  }

  function restoreFonts() {
    for (const [el, before] of fontTouched) el.style.fontFamily = before;
    fontTouched.clear();
  }

  function write(node: Text, value: string) {
    if (!originals.has(node)) originals.set(node, node.nodeValue ?? "");
    if (node.nodeValue !== value) node.nodeValue = value;
    written.set(node, value);
  }

  function restoreBlocks(blocks: Block[], all = false) {
    applying = true;
    try {
      for (const b of blocks) {
        for (const p of b.pieces) {
          const orig = originals.get(p.node);
          if (orig !== undefined && p.node.nodeValue !== orig) p.node.nodeValue = orig;
          written.delete(p.node);
        }
      }
      if (all) {
        for (const el of dirTouched) el.removeAttribute("dir");
        dirTouched.clear();
        restoreFonts();
      } else {
        for (const b of blocks) {
          if (dirTouched.delete(b.el)) b.el.removeAttribute("dir");
          for (const p of b.pieces) {
            const el = p.node.parentElement;
            if (el && fontTouched.has(el)) {
              el.style.fontFamily = fontTouched.get(el)!;
              fontTouched.delete(el);
            }
          }
        }
      }
    } finally {
      observer?.takeRecords();
      applying = false;
    }
  }

  function loadPublished(lang: string): Promise<Record<string, string>> {
    let p = published.get(lang);
    if (!p) {
      p = fetch(`${staticBase}/t/${encodeURIComponent(lang)}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : {}))
        .catch(() => {
          published.delete(lang); // try again next time
          return {};
        });
      published.set(lang, p);
    }
    return p;
  }

  async function run(lang: string, blocks: Block[], gen: number, animate = false) {
    if (staticBase) {
      // Static mode: apply published translations. Ask the server only for the rest, if there is one.
      if (!blocks.some((b) => cache.has(`${lang}\0${b.text}`))) status({ state: "translating", language: lang });
      const map = await loadPublished(lang);
      if (gen !== generation) return;
      const rest: Block[] = [];
      let hits = 0;
      const swap = () => {
        for (const b of blocks) {
          const t = cache.get(`${lang}\0${b.text}`) ?? map[textHash(b.text.trim())];
          if (t !== undefined) {
            cache.set(`${lang}\0${b.text}`, t);
            apply(b, t, lang);
            hits++;
          } else rest.push(b);
        }
        // Nothing published for these: show them as written (not the previous language).
        if (!endpoint) restoreBlocks(rest);
      };
      if (animate && opts.transition) {
        let swapped = false;
        try {
          opts.transition(blocks.map((b) => b.el), () => {
            swapped = true;
            swap();
          });
        } catch {
          /* a broken transition must never stop the switch */
        }
        if (!swapped) swap();
      } else swap();
      if (!endpoint || !rest.length) {
        status({ state: "done", language: lang, translated: hits, failed: 0, missing: rest.length });
        return;
      }
      blocks = rest;
    }
    return runServer(lang, blocks, gen);
  }

  async function runServer(lang: string, blocks: Block[], gen: number) {
    // Apply anything we already have, instantly: first this session's answers, then the
    // copy saved in the browser from an earlier visit (which we still re-check with the server).
    const todo: Block[] = [];
    const local = persistedFor(lang);
    let fromBrowser = 0;
    for (const b of blocks) {
      const key = `${lang}\0${b.text}`;
      const hit = cache.get(key);
      if (hit !== undefined) {
        apply(b, hit, lang);
        continue;
      }
      if (failed.has(key)) continue;
      const saved = local[textHash(b.text)];
      if (saved !== undefined) {
        apply(b, saved, lang);
        fromBrowser++;
      }
      todo.push(b);
    }
    if (!todo.length) {
      status({ state: "done", language: lang, translated: blocks.length, failed: 0 });
      return;
    }

    // If the browser copy already covered everything, check for updates silently.
    const silent = fromBrowser === todo.length;
    if (silent) status({ state: "done", language: lang, translated: blocks.length, failed: 0 });
    else status({ state: "translating", language: lang });
    let translated = 0;
    let failedCount = 0;
    // Send the whole page context with each batch, top of page first.
    const batches = batch(todo);
    const context = {
      title: document.title,
      url: location.origin + location.pathname,
      description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? undefined,
      notes: opts.notes,
    };
    try {
      for (const group of batches) {
        if (gen !== generation) return; // language changed mid-flight
        const res = await fetch(`${endpoint}/v1/channels/framer/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetLanguage: lang,
            sourceLanguage: opts.sourceLanguage,
            contentType: opts.contentType,
            doNotTranslate: opts.doNotTranslate,
            glossary: opts.glossary,
            context,
            segments: group.map((b) => ({ id: b.id, text: b.text, role: roleOf(b.el), group: groupOf(b.el) })),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as TranslateResponse;
        if (gen !== generation) return;
        const byId = new Map<string, SegmentResult>(data.results.map((r) => [r.id, r]));
        for (const b of group) {
          const r = byId.get(b.id);
          if (!r || r.status === "fallback") {
            restoreBlocks([b]); // show it as written rather than in the previous language
            failed.add(`${lang}\0${b.text}`);
            failedCount++;
            continue;
          }
          cache.set(`${lang}\0${b.text}`, r.text);
          local[textHash(b.text)] = r.text;
          apply(b, r.text, lang);
          translated++;
        }
        savePersisted();
      }
      if (!silent) status({ state: "done", language: lang, translated, failed: failedCount });
    } catch (e) {
      // Don't hammer a failing server on every re-render; the next explicit pick retries.
      for (const b of todo) if (!cache.has(`${lang}\0${b.text}`)) failed.add(`${lang}\0${b.text}`);
      if (silent) return; // the page already shows the browser copy; try again next visit
      status({ state: "error", language: lang, translated, failed: failedCount, error: e instanceof Error ? e.message : String(e) });
    }
  }

  function startObserver() {
    if (observer || opts.observe === false) return;
    observer = new MutationObserver((records) => {
      if (applying || !language) return;
      if (!records.some((r) => r.type === "characterData" || r.addedNodes.length)) return;
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        if (!language) return;
        const lang = language;
        // Only blocks whose text isn't already showing a translation.
        const blocks = collect().filter((b) => b.pieces.some((p) => written.get(p.node) !== p.node.nodeValue));
        if (blocks.length) void run(lang, blocks, generation);
      }, 350);
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
  }

  const controller: PonteController = {
    get language() {
      return language;
    },
    async translate(lang: string, options?: { animate?: boolean }) {
      const gen = ++generation;
      failed.clear(); // an explicit pick retries anything that failed before
      const blocks = collect();
      if (!lang) {
        controller.restore();
        return;
      }
      // Picking the page's own language is a real choice too: it translates whatever is
      // written in other languages (e.g. Hindi poems on an English page) into it.
      language = lang;
      remember(lang);
      window.dispatchEvent(new CustomEvent("ponte:language", { detail: { language: lang } }));
      startObserver();
      await run(lang, blocks, gen, options?.animate === true);
    },
    restore() {
      generation++;
      language = null;
      remember(null);
      restoreBlocks(collect(), true);
      window.dispatchEvent(new CustomEvent("ponte:language", { detail: { language: null } }));
      status({ state: "idle", language: null });
    },
    destroy() {
      controller.restore();
      observer?.disconnect();
      observer = null;
      clearTimeout(pendingTimer);
    },
  };

  function remember(lang: string | null) {
    if (opts.remember === false) return;
    try {
      // "original" is remembered too, so automatic detection won't override that choice.
      localStorage.setItem(STORAGE_KEY, lang || ORIGINAL);
    } catch {
      /* storage unavailable */
    }
  }

  return controller;
}

const ORIGINAL = "original";

/** The language the visitor explicitly asked for: ?lang= in the URL, else their last choice. */
export function preferredLanguage(): string | null {
  try {
    const fromUrl = new URLSearchParams(location.search).get("lang");
    const v = fromUrl || localStorage.getItem(STORAGE_KEY);
    return v && v !== ORIGINAL ? v : null;
  } catch {
    return null;
  }
}

/** Short code of a BCP-47 tag: "hi-IN" → "hi", "pt_BR" → "pt". */
function shortCode(tag: string): string {
  return tag.trim().toLowerCase().replace("_", "-").split("-")[0] ?? "";
}

/** The page's own language: data attribute, else <html lang>, else English. */
export function pageLanguage(explicit?: string): string {
  return shortCode(explicit || document.documentElement.getAttribute("lang") || "en") || "en";
}

/**
 * Which language to show when a visitor arrives:
 *   1. ?lang=xx in the URL (?lang=original forces the original)
 *   2. the visitor's last choice on this site (including "Original")
 *   3. if auto is on: the first of the visitor's device/browser languages that is either
 *      the page's own language (→ original) or one we've published (→ that language)
 * Returns null for "show the original".
 */
export function initialLanguage(opts: { available: string[]; source: string; auto?: boolean; languages?: readonly string[] }): string | null {
  const available = new Set(opts.available.map(shortCode));
  const source = shortCode(opts.source);
  const pick = (v: string | null | undefined): string | null | undefined => {
    if (!v) return undefined;
    const c = shortCode(v);
    if (c === ORIGINAL) return null;
    // The page's own language means "as written" unless a translation into it is published.
    if (c === source && !available.has(c)) return null;
    return c;
  };
  try {
    const fromUrl = pick(new URLSearchParams(location.search).get("lang"));
    if (fromUrl !== undefined) return fromUrl;
  } catch {
    /* no location */
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return pick(stored) ?? null;
  } catch {
    /* storage unavailable */
  }
  if (opts.auto === false) return null;
  const visitor = opts.languages ?? (typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : []);
  for (const tag of visitor) {
    const c = shortCode(tag);
    if (c === source) return null; // they read the original's language: leave it
    if (available.has(c)) return c;
  }
  return null;
}

/** Split "⟦0⟧Hello ⟦1⟧world" into ["Hello ", "world"] by marker index. Null if any marker is missing. */
export function splitMarkers(text: string, count: number): string[] | null {
  const re = /⟦(\d+)⟧/g;
  const found: Array<{ idx: number; start: number; end: number }> = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    found.push({ idx: Number(m[1]), start: m.index, end: m.index + m[0].length });
  }
  if (found.length !== count) return null;
  const out = new Array<string>(count).fill("");
  const seen = new Set<number>();
  found.forEach((f, i) => {
    if (f.idx >= count || seen.has(f.idx)) return;
    seen.add(f.idx);
    out[f.idx] = text.slice(f.end, found[i + 1]?.start ?? text.length);
  });
  // Text before the first marker (shouldn't happen) is attached to the first marker's piece.
  const head = text.slice(0, found[0]?.start ?? 0);
  if (head.trim() && found[0]) out[found[0].idx] = head + out[found[0].idx];
  return seen.size === count ? out : null;
}

function batch(blocks: Block[]): Block[][] {
  const out: Block[][] = [];
  let cur: Block[] = [];
  let chars = 0;
  for (const b of blocks) {
    if (cur.length && (cur.length >= BATCH_SEGMENTS || chars + b.text.length > BATCH_CHARS)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(b);
    chars += b.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Short, stable hash of a string (cyrb53), used to key the browser copy. */
export function textHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|emoji|math)$/i;

/**
 * Insert the script font before any trailing generic family, so the element's own
 * fonts still draw what they can and Noto (not the device default) draws the rest.
 */
export function withScriptFont(own: string, noto: string): string {
  const families = own.split(",").map((f) => f.trim()).filter(Boolean);
  if (families.some((f) => f.replace(/["']/g, "").toLowerCase() === noto.toLowerCase())) return own;
  // Only the final fallback moves after Noto; "system-ui, sans-serif" keeps system-ui first so
  // Latin text keeps its look (Noto fonts also contain Latin letters).
  const last = families[families.length - 1];
  const i = last && GENERIC.test(last.replace(/["']/g, "")) ? families.length - 1 : families.length;
  families.splice(i, 0, `"${noto}"`);
  return families.join(", ");
}
