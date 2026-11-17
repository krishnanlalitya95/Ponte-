/**
 * Matching fonts for translated text.
 *
 * Most Framer fonts only contain Latin letters, so Hindi, Tamil, Japanese… would fall
 * back to whatever system font the device has. Ponte instead loads the free Google
 * Noto font for that script, choosing Serif or Sans to match each element, and adds it
 * *after* the element's own font. The original font still draws Latin letters, numbers
 * and names; Noto draws only the characters it lacks.
 */

interface ScriptFonts {
  sans: string;
  serif: string;
}

/** Noto families on Google Fonts, per language. Latin/Cyrillic languages need nothing. */
export const SCRIPT_FONTS: Record<string, ScriptFonts> = {
  hi: { sans: "Noto Sans Devanagari", serif: "Noto Serif Devanagari" },
  mr: { sans: "Noto Sans Devanagari", serif: "Noto Serif Devanagari" },
  bn: { sans: "Noto Sans Bengali", serif: "Noto Serif Bengali" },
  ta: { sans: "Noto Sans Tamil", serif: "Noto Serif Tamil" },
  te: { sans: "Noto Sans Telugu", serif: "Noto Serif Telugu" },
  gu: { sans: "Noto Sans Gujarati", serif: "Noto Serif Gujarati" },
  kn: { sans: "Noto Sans Kannada", serif: "Noto Serif Kannada" },
  ml: { sans: "Noto Sans Malayalam", serif: "Noto Serif Malayalam" },
  pa: { sans: "Noto Sans Gurmukhi", serif: "Noto Serif Gurmukhi" },
  or: { sans: "Noto Sans Oriya", serif: "Noto Serif Oriya" },
  ur: { sans: "Noto Nastaliq Urdu", serif: "Noto Nastaliq Urdu" },
  ar: { sans: "Noto Sans Arabic", serif: "Noto Naskh Arabic" },
  ja: { sans: "Noto Sans JP", serif: "Noto Serif JP" },
  zh: { sans: "Noto Sans SC", serif: "Noto Serif SC" },
  ko: { sans: "Noto Sans KR", serif: "Noto Serif KR" },
};

const SERIF_HINT =
  /\b(serif|georgia|times|garamond|baskerville|playfair|merriweather|lora|fraunces|cormorant|newsreader|spectral|crimson|bodoni|caslon|didot|cambria|charter|tiempos|freight|literata|domine|instrument serif|young serif|gloock)\b/i;

/** Pick Serif when the element's own font looks like a serif, otherwise Sans. */
export function fontFor(lang: string, currentFamily: string): string | null {
  const fonts = SCRIPT_FONTS[lang];
  if (!fonts) return null;
  const families = currentFamily
    .toLowerCase()
    .split(",")
    .map((x) => x.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  const primary = families[0] ?? "";
  let serif: boolean;
  if (/\bsans\b/.test(primary)) serif = false;
  else if (SERIF_HINT.test(primary)) serif = true;
  else serif = families.includes("serif");
  return serif ? fonts.serif : fonts.sans;
}

const loaded = new Set<string>();

/** Add the Google Fonts stylesheet for a family once (400–700, swap so text shows immediately). */
export function loadFont(family: string, doc: Document = document): void {
  if (loaded.has(family)) return;
  loaded.add(family);
  const id = `ponte-font-${family.replace(/\s+/g, "-").toLowerCase()}`;
  if (doc.getElementById(id)) return;
  if (!doc.querySelector('link[data-ponte-preconnect]')) {
    for (const href of ["https://fonts.googleapis.com", "https://fonts.gstatic.com"]) {
      const pre = doc.createElement("link");
      pre.rel = "preconnect";
      pre.href = href;
      if (href.includes("gstatic")) pre.crossOrigin = "";
      pre.setAttribute("data-ponte-preconnect", "");
      doc.head.append(pre);
    }
  }
  const link = doc.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap`;
  doc.head.append(link);
}

/** For tests. */
export function _resetLoadedFonts(): void {
  loaded.clear();
}
