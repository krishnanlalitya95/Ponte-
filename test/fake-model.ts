import type { ModelClient, StructuredCall, StructuredResult } from "../src/core/model.js";

/** Scriptable stand-in for Claude. `respond` decides what each call returns. */
export class FakeModel implements ModelClient {
  readonly model = "fake-model";
  calls: StructuredCall[] = [];
  constructor(private respond: (call: StructuredCall, n: number) => unknown) {}
  async structured<T>(call: StructuredCall): Promise<StructuredResult<T>> {
    this.calls.push(call);
    const data = this.respond(call, this.calls.length);
    if (data instanceof Error) throw data;
    return { data: data as T, inputTokens: 100, outputTokens: 50 };
  }
}

export const BRIEF = {
  contentType: "portfolio_copy",
  tone: "warm, confident",
  register: "professional",
  audience: "recruiters",
  summary: "A designer's portfolio.",
  glossary: [{ term: "CareOne", treatment: "keep" }],
  translationNotes: "Use आप.",
  dominantLanguage: "en",
};

/** Pull the segments JSON out of a translate prompt. */
export function segmentsIn(call: StructuredCall): Array<{ id: string; text: string }> {
  const m = /<segments>\n([\s\S]*?)\n<\/segments>/.exec(call.user);
  return m ? JSON.parse(m[1]!) : [];
}

/** A translator that prefixes "HI:" to each segment and keeps markers. */
export function prefixTranslator(call: StructuredCall) {
  if (call.toolName === "write_brief") return BRIEF;
  return {
    results: segmentsIn(call).map((s) => ({
      id: s.id,
      sourceLanguage: "en",
      action: "translated",
      translation: s.text.replace(/(⟦\d+⟧)?([^⟦]+)/g, (_m, mk = "", t) => `${mk}HI:${t}`),
    })),
  };
}
