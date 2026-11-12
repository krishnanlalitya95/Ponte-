import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import {
  TranslationBatchSchema,
  type SubmitReplacementsResult,
} from "../lib/replacements.js";

export default defineTool({
  description: prompt`
    Submit the final plain-text translation batch for in-place Framer
    updates. Call once per request after you detect language and content
    type and finish meaning-first translation. Keep segment ids stable.
  `,
  effect: "idempotent",
  inputSchema: TranslationBatchSchema,
  async execute(input, ctx): Promise<SubmitReplacementsResult> {
    const batchKey = `${ctx.session.id}:translation`;
    const artifact = await ctx.artifacts.tag({
      kind: "translation-batch",
      key: batchKey,
      title: `${input.sourceLanguage} → ${input.targetLanguage} (${input.contentType})`,
      data: input,
    });

    await ctx.host.kv.put(batchKey, {
      artifactId: artifact.id,
      updatedAt: new Date().toISOString(),
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      contentType: input.contentType,
      segmentCount: input.replacements.length,
    });

    return {
      ok: true,
      batchKey,
      artifactId: artifact.id,
      segmentCount: input.replacements.length,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      contentType: input.contentType,
    };
  },
});
