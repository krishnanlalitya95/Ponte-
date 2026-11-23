import type { ModelClient, StructuredCall, StructuredResult } from "./model.js";

/**
 * Offline stand-in for Claude (PONTE_MOCK=1). Returns a pseudo-translation
 * ("[hi] Hello") so you can wire up Framer, test the widget and check layouts
 * without an API key or spending credits. Never use it for real translations.
 */
export class MockModelClient implements ModelClient {
  readonly model = "mock";

  async structured<T>(call: StructuredCall): Promise<StructuredResult<T>> {
    await new Promise((r) => setTimeout(r, 300));
    if (call.toolName === "write_brief") {
      return {
        data: {
          contentType: "mixed",
          tone: "mock",
          register: "mock",
          audience: "mock",
          summary: "Mock mode: no real analysis.",
          glossary: [],
          translationNotes: "",
          dominantLanguage: "en",
        } as T,
        inputTokens: 0,
        outputTokens: 0,
      };
    }
    if (call.toolName === "submit_review") {
      const items = JSON.parse(/<segments>\n([\s\S]*?)\n<\/segments>/.exec(call.user)?.[1] ?? "[]") as Array<{ id: string }>;
      return { data: { results: items.map((it) => ({ id: it.id, verdict: "ok" })) } as T, inputTokens: 0, outputTokens: 0 };
    }
    if (call.toolName === "submit_words") {
      const lang = /Word lookups in .*?\((\w+)\)/.exec(call.user)?.[1] ?? "xx";
      const items = JSON.parse(/<segments>\n([\s\S]*?)\n<\/segments>/.exec(call.user)?.[1] ?? "[]") as Array<{ id: string; original: string }>;
      return {
        data: {
          results: items.map((it) => ({
            id: it.id,
            words: (it.original.match(/\p{L}{4,}/gu) ?? []).map((w) => ({ s: w, t: "", c: `[${lang}] ${w}`, d: `[${lang}] ${w} (dictionary)` })),
          })),
        } as T,
        inputTokens: 0,
        outputTokens: 0,
      };
    }
    const lang = /Translate into .*?\((\w+)\)/.exec(call.user)?.[1] ?? "xx";
    const segs = JSON.parse(/<segments>\n([\s\S]*?)\n<\/segments>/.exec(call.user)?.[1] ?? "[]") as Array<{ id: string; text: string }>;
    return {
      data: {
        results: segs.map((s) => ({
          id: s.id,
          sourceLanguage: "en",
          action: "translated",
          // Keep markers; tag each piece so you can see every node was replaced.
          translation: s.text.replace(/(⟦\d+⟧)?([^⟦]+)/g, (_m, mk = "", t: string) => `${mk}[${lang}] ${t}`),
        })),
      } as T,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  async batch(calls: Array<{ id: string; call: StructuredCall }>, onProgress: (m: string) => void = () => {}) {
    const out = new Map<string, StructuredResult<unknown> | Error>();
    for (const c of calls) out.set(c.id, await this.structured(c.call));
    onProgress(`mock batch: ${calls.length} request(s)`);
    return out;
  }
}
