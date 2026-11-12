import { defineArtifacts } from "@grok/agent-sdk/artifacts";
import { TranslationBatchSchema } from "./lib/replacements.js";

export default defineArtifacts({
  kinds: {
    "translation-batch": {
      description:
        "Structured plain-text replacements for in-place Framer updates.",
      schema: TranslationBatchSchema,
    },
  },
});
