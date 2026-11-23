/**
 * Dust transition for a language switch: the text on screen breaks into fine dust that
 * blows away from left to right (like Safari's "Hide Distracting Items"), while the new
 * language fades in underneath.
 *
 * - Only text that is on screen animates; everything else switches instantly.
 * - Never changes the page's text nodes (the engine tracks them); it measures words with
 *   Ranges and only sets opacity on the blocks, restoring their own inline styles after.
 * - Off for visitors who ask for reduced motion, and falls back to a plain fade if the
 *   device can't keep up.
 */

export interface SnapOptions {
  /** Whole effect, in ms. */
  duration?: number;
  /** Gap between dust grains in CSS px (1 = densest). */
  gap?: number;
  /** Most grains to animate at once; the gap widens on very text-heavy screens. */
  maxParticles?: number;
  /** Share of grains drawn in the accent colour (0 = none). */
  accentShare?: number;
  accent?: string;
}

type Swap = () => void;

interface Grain {
  x: number;
  y: number;
  dx: number;
  dy: number;
  delay: number;
  rgb: number; // 0xBBGGRR
}

const DEFAULTS = { duration: 2200, gap: 1, maxParticles: 26000, accentShare: 0.3 };
let active: { cancel: () => void } | null = null;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function onScreen(r: DOMRect): boolean {
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
}

/** "rgb(12, 34, 56)" / "#0c2238" → 0xBBGGRR, or null for transparent. */
export function parseColor(c: string | undefined): number | null {
  if (!c) return null;
  let m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (m) {
    const n = parseInt(m[1]!, 16);
    return ((n & 0xff) << 16) | (n & 0xff00) | ((n >> 16) & 0xff);
  }
  m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(c);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  return (Number(m[3]) << 16) | (Number(m[2]) << 8) | Number(m[1]);
}

/** Paints every word of `els` onto a canvas at its exact on-screen spot, without touching the DOM. */
function paintWords(els: HTMLElement[], o: CanvasRenderingContext2D, ox: number, oy: number): Array<{ top: number; bottom: number; rgb: number }> {
  const bands: Array<{ top: number; bottom: number; rgb: number }> = [];
  const range = document.createRange();
  for (const el of els) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const parent = n.parentElement;
      if (!parent) continue;
      const cs = getComputedStyle(parent);
      if (cs.visibility === "hidden") continue;
      const rgb = parseColor(cs.color) ?? parseColor(cs.webkitTextFillColor) ?? 0x777777;
      o.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      o.textBaseline = "middle";
      o.fillStyle = "#000";
      const text = n.nodeValue ?? "";
      for (const w of text.matchAll(/\S+/gu)) {
        range.setStart(n, w.index!);
        range.setEnd(n, w.index! + w[0].length);
        const r = range.getClientRects()[0];
        if (!r || !onScreen(r)) continue;
        o.fillText(w[0], r.left - ox, r.top - oy + r.height / 2);
        bands.push({ top: r.top - oy, bottom: r.bottom - oy, rgb });
      }
    }
  }
  range.detach?.();
  return bands;
}

/**
 * Hide the visible blocks, run `swap` (which puts the new language in), blow the old words
 * away as dust and fade the new words in. `swap` always runs, synchronously.
 */
export function snapSwap(blocks: Element[], swap: Swap, options: SnapOptions = {}): void {
  active?.cancel();
  const o = { ...DEFAULTS, ...options };
  const visible = blocks.filter((b): b is HTMLElement => b instanceof HTMLElement && onScreen(b.getBoundingClientRect()));
  if (!visible.length || prefersReducedMotion() || typeof document.createElement("canvas").getContext !== "function") {
    swap();
    return;
  }

  // 1. Dust from the words as they look now.
  const dpr = Math.min(2, devicePixelRatio || 1);
  const box = visible.map((b) => b.getBoundingClientRect()).reduce((a, r) => ({
    left: Math.min(a.left, r.left), top: Math.min(a.top, r.top), right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom),
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  // Room for the drift: grains travel up to ~95px right and ~60px up.
  const left = Math.max(0, box.left - 8), top = Math.max(0, box.top - 70);
  const right = Math.min(innerWidth, box.right + 100), bottom = Math.min(innerHeight, box.bottom + 8);
  const W = Math.ceil((right - left) * dpr), H = Math.ceil((bottom - top) * dpr);
  if (W <= 0 || H <= 0) {
    swap();
    return;
  }
  const off = document.createElement("canvas");
  off.width = W;
  off.height = H;
  const oc = off.getContext("2d", { willReadFrequently: true });
  if (!oc) {
    swap();
    return;
  }
  oc.scale(dpr, dpr);
  const bands = paintWords(visible, oc, left, top);
  const ink = oc.getImageData(0, 0, W, H).data;

  let inked = 0;
  for (let i = 3; i < ink.length; i += 4) if (ink[i]! > 90) inked++;
  const base = Math.max(1, Math.round(o.gap * dpr));
  const step = Math.max(base, Math.ceil(Math.sqrt(inked / o.maxParticles)));
  const accent = parseColor(o.accent);
  const textW = Math.max(1, box.right - box.left);
  const grains: Grain[] = [];
  for (let y = 0; y < H; y += step) {
    const yy = y / dpr;
    const band = bands.find((b) => yy >= b.top - 2 && yy <= b.bottom + 2);
    for (let x = 0; x < W; x += step) {
      if (ink[(y * W + x) * 4 + 3]! <= 90) continue;
      const xx = x / dpr;
      grains.push({
        x: xx + (Math.random() - 0.5) * 0.6,
        y: yy + (Math.random() - 0.5) * 0.6,
        dx: 25 + Math.random() * 70,
        dy: -60 + Math.random() * 30,
        delay: ((xx + left - box.left) / textW) * 0.5 + Math.random() * 0.05,
        rgb: accent !== null && Math.random() < o.accentShare ? accent : band?.rgb ?? 0x777777,
      });
    }
  }

  // 2. Hide the old words, swap in the new language (still hidden).
  const saved = visible.map((el) => ({
    el,
    opacity: el.style.getPropertyValue("opacity"),
    opacityPrio: el.style.getPropertyPriority("opacity"),
    transition: el.style.getPropertyValue("transition"),
    transitionPrio: el.style.getPropertyPriority("transition"),
  }));
  for (const { el } of saved) {
    el.style.setProperty("transition", "none", "important");
    el.style.setProperty("opacity", "0", "important");
  }
  swap();

  // 3. Animate.
  const cv = document.createElement("canvas");
  cv.setAttribute("data-ponte-skip", "");
  cv.setAttribute("aria-hidden", "true");
  cv.width = W;
  cv.height = H;
  cv.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${W / dpr}px;height:${H / dpr}px;pointer-events:none;z-index:2147482999`;
  document.body.append(cv);
  const ctx = cv.getContext("2d")!;
  const frame = ctx.createImageData(W, H);
  const px = new Uint32Array(frame.data.buffer);
  const size = Math.max(1, Math.round(dpr)); // 1 CSS px grains

  let raf = 0;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const fadeIn = () => {
    for (const { el } of saved) {
      el.style.setProperty("transition", "opacity .5s ease", "important");
      el.style.setProperty("opacity", "1", "important");
    }
  };
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    clearTimeout(fadeTimer);
    cv.remove();
    for (const s of saved) {
      if (s.opacity) s.el.style.setProperty("opacity", s.opacity, s.opacityPrio);
      else s.el.style.removeProperty("opacity");
      if (s.transition) s.el.style.setProperty("transition", s.transition, s.transitionPrio);
      else s.el.style.removeProperty("transition");
    }
    if (active === handle) active = null;
  };
  const handle = { cancel: finish };
  active = handle;
  fadeTimer = setTimeout(fadeIn, o.duration * 0.4);

  const t0 = performance.now();
  let slowFrames = 0;
  let last = t0;
  const draw = (now: number) => {
    const t = Math.min(1, (now - t0) / o.duration);
    // A device that can't keep up gets the plain fade instead of a stuttering effect.
    if (now - last > 50) slowFrames++;
    last = now;
    if (slowFrames > 6) {
      cv.remove();
      fadeIn();
      fadeTimer = setTimeout(finish, 600);
      return;
    }
    px.fill(0);
    for (const g of grains) {
      const u = Math.max(0, Math.min(1, (t - g.delay) / 0.45));
      let x = g.x, y = g.y, a = 1;
      if (u > 0) {
        const e = 1 - (1 - u) * (1 - u);
        x += g.dx * e;
        y += g.dy * e;
        a = Math.max(0, 1 - u * 1.1);
        if (a <= 0) continue;
      }
      const X = Math.round(x * dpr), Y = Math.round(y * dpr);
      if (X < 0 || Y < 0 || X + size > W || Y + size > H) continue;
      const v = ((Math.round(a * 255) & 0xff) << 24) | g.rgb;
      for (let j = 0; j < size; j++) {
        const row = (Y + j) * W + X;
        for (let i = 0; i < size; i++) px[row + i] = v;
      }
    }
    ctx.putImageData(frame, 0, 0);
    if (t < 1) raf = requestAnimationFrame(draw);
    else fadeTimer = setTimeout(finish, 520); // let the fade-in end before restoring styles
  };
  raf = requestAnimationFrame(draw);
}
