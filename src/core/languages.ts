/**
 * Language registry. Codes are BCP-47. `script` is the primary writing system,
 * used for fast local detection hints and to tell the model which script to write in.
 */
export interface Language {
  code: string;
  name: string;
  nativeName: string;
  script: string;
  region: "india" | "global";
  rtl?: boolean;
}

export const LANGUAGES: Language[] = [
  // Major Indian languages
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", script: "Devanagari", region: "india" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", script: "Bengali", region: "india" },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", script: "Tamil", region: "india" },
  { code: "te", name: "Telugu", nativeName: "తెలుగు", script: "Telugu", region: "india" },
  { code: "mr", name: "Marathi", nativeName: "मराठी", script: "Devanagari", region: "india" },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી", script: "Gujarati", region: "india" },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ", script: "Kannada", region: "india" },
  { code: "ml", name: "Malayalam", nativeName: "മലയാളം", script: "Malayalam", region: "india" },
  { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", script: "Gurmukhi", region: "india" },
  { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ", script: "Odia", region: "india" },
  { code: "ur", name: "Urdu", nativeName: "اردو", script: "Arabic (Nastaliq)", region: "india", rtl: true },
  // Major global languages
  { code: "en", name: "English", nativeName: "English", script: "Latin", region: "global" },
  { code: "es", name: "Spanish", nativeName: "Español", script: "Latin", region: "global" },
  { code: "fr", name: "French", nativeName: "Français", script: "Latin", region: "global" },
  { code: "de", name: "German", nativeName: "Deutsch", script: "Latin", region: "global" },
  { code: "pt", name: "Portuguese", nativeName: "Português", script: "Latin", region: "global" },
  { code: "it", name: "Italian", nativeName: "Italiano", script: "Latin", region: "global" },
  { code: "ja", name: "Japanese", nativeName: "日本語", script: "Japanese (Kanji/Kana)", region: "global" },
  { code: "zh", name: "Chinese (Simplified)", nativeName: "简体中文", script: "Han (Simplified)", region: "global" },
  { code: "ko", name: "Korean", nativeName: "한국어", script: "Hangul", region: "global" },
  { code: "ar", name: "Arabic", nativeName: "العربية", script: "Arabic", region: "global", rtl: true },
  { code: "ru", name: "Russian", nativeName: "Русский", script: "Cyrillic", region: "global" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", script: "Latin", region: "global" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", script: "Latin", region: "global" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands", script: "Latin", region: "global" },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function getLanguage(code: string): Language | undefined {
  return BY_CODE.get(normalizeLanguageCode(code));
}

/** "hi-IN" → "hi", "zh-Hans" → "zh", "PT_br" → "pt". */
export function normalizeLanguageCode(code: string): string {
  return code.trim().toLowerCase().replace("_", "-").split("-")[0] ?? "";
}

export function isSupported(code: string): boolean {
  return BY_CODE.has(normalizeLanguageCode(code));
}

/**
 * Unicode-script hint for a string. Cheap and local; used to skip text that is
 * clearly already in the target script and to give the model a starting point.
 * Returns candidate language codes (a script can map to several languages).
 */
const SCRIPT_RANGES: Array<[RegExp, string[]]> = [
  [/[ऀ-ॿ]/g, ["hi", "mr"]],
  [/[ঀ-৿]/g, ["bn"]],
  [/[਀-੿]/g, ["pa"]],
  [/[઀-૿]/g, ["gu"]],
  [/[଀-୿]/g, ["or"]],
  [/[஀-௿]/g, ["ta"]],
  [/[ఀ-౿]/g, ["te"]],
  [/[ಀ-೿]/g, ["kn"]],
  [/[ഀ-ൿ]/g, ["ml"]],
  [/[぀-ヿ]/g, ["ja"]],
  [/[가-힯ᄀ-ᇿ]/g, ["ko"]],
  [/[一-鿿]/g, ["zh", "ja"]],
  [/[؀-ۿ]/g, ["ar", "ur"]],
  [/[Ѐ-ӿ]/g, ["ru"]],
  [/[A-Za-zÀ-ɏ]/g, ["en", "es", "fr", "de", "pt", "it", "id", "tr", "nl"]],
];

export function scriptCandidates(text: string): string[] {
  let best: string[] = [];
  let bestCount = 0;
  for (const [re, langs] of SCRIPT_RANGES) {
    const count = text.match(re)?.length ?? 0;
    if (count > bestCount) {
      best = langs;
      bestCount = count;
    }
  }
  // Kana anywhere means Japanese even if Han dominates.
  if (best.includes("zh") && /[぀-ヿ]/.test(text)) return ["ja"];
  return best;
}

/** True when a segment carries nothing worth translating (numbers, URLs, emails, symbols). */
export function isUntranslatable(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return true;
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(t)) return true;
  if (!/\p{L}/u.test(t)) return true; // no letters at all: "2024", "→", "©", "01 / 04"
  return false;
}
