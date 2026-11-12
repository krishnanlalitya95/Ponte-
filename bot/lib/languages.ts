/** Supported Ponte target/source language codes and display names. */
export type Language = {
  code: string;
  name: string;
  group: "indian" | "global";
};

export const SUPPORTED_LANGUAGES: readonly Language[] = [
  { code: "hi", name: "Hindi", group: "indian" },
  { code: "bn", name: "Bengali", group: "indian" },
  { code: "ta", name: "Tamil", group: "indian" },
  { code: "te", name: "Telugu", group: "indian" },
  { code: "mr", name: "Marathi", group: "indian" },
  { code: "gu", name: "Gujarati", group: "indian" },
  { code: "kn", name: "Kannada", group: "indian" },
  { code: "ml", name: "Malayalam", group: "indian" },
  { code: "pa", name: "Punjabi", group: "indian" },
  { code: "en", name: "English", group: "global" },
  { code: "es", name: "Spanish", group: "global" },
  { code: "fr", name: "French", group: "global" },
  { code: "de", name: "German", group: "global" },
  { code: "pt", name: "Portuguese", group: "global" },
  { code: "ja", name: "Japanese", group: "global" },
  { code: "zh", name: "Chinese", group: "global" },
  { code: "ar", name: "Arabic", group: "global" },
  { code: "ko", name: "Korean", group: "global" },
] as const;

export const LANGUAGE_CODES = new Set(
  SUPPORTED_LANGUAGES.map((language) => language.code),
);

export function isSupportedLanguage(code: string): boolean {
  return LANGUAGE_CODES.has(code);
}
