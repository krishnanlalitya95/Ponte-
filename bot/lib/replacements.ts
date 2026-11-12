import * as z from "zod/v4";
import { isSupportedLanguage } from "./languages.js";

/** Hard caps for Framer batch payloads. */
export const MAX_SEGMENTS = 40;
export const MAX_CHARS_PER_SEGMENT = 4000;

export const contentTypes = [
  "poetry",
  "narrative",
  "case_study",
  "paper",
  "portfolio",
  "other",
] as const;

export type ContentType = (typeof contentTypes)[number];

export const ReplacementSegmentSchema = z.object({
  id: z.string().min(1).max(128),
  original: z.string().min(1).max(MAX_CHARS_PER_SEGMENT),
  translated: z.string().min(1).max(MAX_CHARS_PER_SEGMENT),
});

export const TranslationBatchSchema = z.object({
  sourceLanguage: z
    .string()
    .min(2)
    .max(16)
    .refine(isSupportedLanguage, "Unsupported language code"),
  targetLanguage: z
    .string()
    .min(2)
    .max(16)
    .refine(isSupportedLanguage, "Unsupported language code"),
  contentType: z.enum(contentTypes),
  fidelityNotes: z.string().max(1000).optional(),
  replacements: z
    .array(ReplacementSegmentSchema)
    .min(1)
    .max(MAX_SEGMENTS),
});

export type ReplacementSegment = z.infer<typeof ReplacementSegmentSchema>;
export type TranslationBatch = z.infer<typeof TranslationBatchSchema>;

export type SubmitReplacementsResult = {
  ok: true;
  batchKey: string;
  artifactId: string;
  segmentCount: number;
  sourceLanguage: string;
  targetLanguage: string;
  contentType: ContentType;
};
