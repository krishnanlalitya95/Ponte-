import { defineChannel, POST, localDev } from "@grok/agent-sdk/channels";
import * as z from "zod/v4";
import {
  MAX_CHARS_PER_SEGMENT,
  MAX_SEGMENTS,
} from "../lib/replacements.js";
import { isSupportedLanguage } from "../lib/languages.js";

const SegmentSchema = z.object({
  id: z.string().min(1).max(128),
  text: z.string().min(1).max(MAX_CHARS_PER_SEGMENT),
});

const TranslateBodySchema = z.object({
  targetLanguage: z
    .string()
    .min(2)
    .max(16)
    .refine(isSupportedLanguage, "Unsupported target language"),
  sourceLanguage: z
    .string()
    .min(2)
    .max(16)
    .refine(isSupportedLanguage, "Unsupported source language")
    .optional(),
  pageContext: z.string().max(1000).optional(),
  segments: z.array(SegmentSchema).min(1).max(MAX_SEGMENTS),
});

type FramerState = {
  targetLanguage: string;
  segmentCount: number;
};

function buildPrompt(body: z.infer<typeof TranslateBodySchema>): string {
  const lines = [
    "Translate these Framer plain-text segments for in-place replacement.",
    `Target language code: ${body.targetLanguage}`,
  ];
  if (body.sourceLanguage) {
    lines.push(`Hinted source language: ${body.sourceLanguage}`);
  }
  if (body.pageContext) {
    lines.push(`Page context: ${body.pageContext}`);
  }
  lines.push(
    "Detect language and content type, translate meaning-first, then call submit_replacements with every segment id preserved.",
    "",
    "Segments (JSON):",
    JSON.stringify(body.segments, null, 2),
  );
  return lines.join("\n");
}

export default defineChannel<FramerState>({
  auth: [localDev()],
  state: { targetLanguage: "", segmentCount: 0 },
  routes: [
    POST("/translate", {
      description:
        "Accept a Framer plain-text batch and start a Ponte translation turn.",
      bodySchema: TranslateBodySchema,
      handler: async (_request, { send, waitUntil, body }) => {
        waitUntil(
          send(buildPrompt(body), {
            state: {
              targetLanguage: body.targetLanguage,
              segmentCount: body.segments.length,
            },
            title: `Framer → ${body.targetLanguage} (${body.segments.length})`,
          }),
        );
        // Hosted callers always see 202; deliver results via session stream
        // / artifacts. Local clients should poll the session the platform
        // opens, or use POST /v1/session for a synchronous-style flow.
        return new Response(null, { status: 202 });
      },
    }),
  ],
});
