import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { SUPPORTED_LANGUAGES } from "../lib/languages.js";

export default defineTool({
  description: prompt`
    List Ponte's supported language codes for detection and translation.
    Call this before guessing an unsupported code.
  `,
  effect: "read",
  inputSchema: z.object({
    group: z.enum(["all", "indian", "global"]).optional().default("all"),
  }),
  async execute({ group }) {
    const languages =
      group === "all"
        ? SUPPORTED_LANGUAGES
        : SUPPORTED_LANGUAGES.filter((language) => language.group === group);
    return {
      count: languages.length,
      languages: languages.map((language) => ({
        code: language.code,
        name: language.name,
        group: language.group,
      })),
    };
  },
});
