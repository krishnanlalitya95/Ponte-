import { describe, expect, it } from "vitest";
import { Ponte, PonteError, chunkSegments, validateTranslation } from "../src/core/agent.js";
import { isUntranslatable, scriptCandidates } from "../src/core/languages.js";
import { BRIEF, FakeModel, prefixTranslator, segmentsIn } from "./fake-model.js";

describe("Ponte agent", () => {
  it("reads the page, then translates every segment in order", async () => {
    const model = new FakeModel(prefixTranslator);
    const ponte = new Ponte({ model });
    const out = await ponte.translate({
      targetLanguage: "hi",
      segments: [
        { id: "a", text: "Hello there" },
        { id: "b", text: "2024" },
        { id: "c", text: "⟦0⟧Read the ⟦1⟧full write-up" },
      ],
    });
    expect(model.calls.map((c) => c.toolName)).toEqual(["write_brief", "submit_translations"]);
    expect(out.results.map((r) => [r.id, r.status, r.text])).toEqual([
      ["a", "translated", "HI:Hello there"],
      ["b", "skipped", "2024"],
      ["c", "translated", "⟦0⟧HI:Read the ⟦1⟧HI:full write-up"],
    ]);
    expect(out.brief?.contentType).toBe("portfolio_copy");
    expect(out.usage.modelCalls).toBe(2);
  });

  it("passes the content brief and glossary into the translation prompt", async () => {
    const model = new FakeModel(prefixTranslator);
    await new Ponte({ model }).translate({
      targetLanguage: "hi",
      doNotTranslate: ["Ponte"],
      glossary: { "case study": "केस स्टडी" },
      segments: [{ id: "a", text: "A case study about Ponte" }],
    });
    const prompt = model.calls[1]!.user;
    expect(prompt).toContain("Content type: portfolio_copy");
    expect(prompt).toContain('"CareOne": keep');
    expect(prompt).toContain('"Ponte": keep');
    expect(prompt).toContain('"case study": translate → "केस स्टडी"');
    expect(model.calls[1]!.system).toContain("Hindi");
    expect(model.calls[1]!.system).toContain("Devanagari");
  });

  it("skips text already in the target script without calling the model for it", async () => {
    const model = new FakeModel(prefixTranslator);
    const out = await new Ponte({ model }).translate({
      targetLanguage: "ta",
      segments: [
        { id: "ta", text: "வணக்கம்" },
        { id: "en", text: "Welcome" },
      ],
    });
    expect(out.results[0]).toMatchObject({ status: "unchanged", text: "வணக்கம்" });
    expect(segmentsIn(model.calls[1]!).map((s) => s.id)).toEqual(["en"]);
  });

  it("caches per segment so repeat visits cost no translation calls", async () => {
    const model = new FakeModel(prefixTranslator);
    const ponte = new Ponte({ model });
    const req = { targetLanguage: "hi", context: { url: "https://x.framer.app/" }, segments: [{ id: "a", text: "Hello" }] };
    await ponte.translate(req);
    const again = await ponte.translate({ ...req, segments: [{ id: "z", text: "Hello" }] });
    expect(model.calls).toHaveLength(2);
    expect(again.results[0]).toMatchObject({ id: "z", text: "HI:Hello" });
    expect(again.usage.storedSegments).toBe(1);
  });

  it("translates duplicate text once and fans the result out", async () => {
    const model = new FakeModel(prefixTranslator);
    const out = await new Ponte({ model }).translate({
      targetLanguage: "hi",
      segments: [
        { id: "nav", text: "Contact" },
        { id: "footer", text: "Contact" },
      ],
    });
    expect(segmentsIn(model.calls[1]!)).toHaveLength(1);
    expect(out.results.map((r) => r.text)).toEqual(["HI:Contact", "HI:Contact"]);
  });

  it("retries segments the model dropped or broke, then falls back to the original", async () => {
    let n = 0;
    const model = new FakeModel((call) => {
      if (call.toolName === "write_brief") return BRIEF;
      n++;
      const segs = segmentsIn(call);
      // First call: drop "b" and break markers on "c". Retry: fix "b", still break "c".
      return {
        results: segs
          .filter((s) => !(n === 1 && s.id === "b"))
          .map((s) => ({ id: s.id, sourceLanguage: "en", action: "translated", translation: s.id === "c" ? "no markers" : `HI:${s.text}` })),
      };
    });
    const out = await new Ponte({ model }).translate({
      targetLanguage: "hi",
      segments: [
        { id: "a", text: "One" },
        { id: "b", text: "Two" },
        { id: "c", text: "⟦0⟧Three ⟦1⟧four" },
      ],
    });
    expect(out.results.map((r) => [r.id, r.status])).toEqual([
      ["a", "translated"],
      ["b", "translated"],
      ["c", "fallback"],
    ]);
    expect(out.results[2]!.text).toBe("⟦0⟧Three ⟦1⟧four");
    expect(out.results[2]!.reason).toMatch(/markers/);
  });

  it("falls back gracefully when the model errors on translation", async () => {
    const model = new FakeModel((call) => (call.toolName === "write_brief" ? BRIEF : new Error("overloaded")));
    const out = await new Ponte({ model }).translate({ targetLanguage: "fr", segments: [{ id: "a", text: "Hello" }] });
    expect(out.results[0]).toMatchObject({ status: "fallback", text: "Hello", reason: "overloaded" });
  });

  it("chunks long pages and gives later chunks the preceding text for continuity", async () => {
    const model = new FakeModel(prefixTranslator);
    const segments = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, text: `Sentence number ${i} `.repeat(20) }));
    const out = await new Ponte({ model, chunkChars: 900, concurrency: 1 }).translate({ targetLanguage: "hi", segments });
    const translateCalls = model.calls.filter((c) => c.toolName === "submit_translations");
    expect(translateCalls.length).toBeGreaterThan(1);
    expect(translateCalls[1]!.user).toContain("<preceding_text");
    expect(out.results.every((r) => r.status === "translated")).toBe(true);
  });

  it("honours an author-forced content type", async () => {
    const model = new FakeModel(prefixTranslator);
    const out = await new Ponte({ model }).translate({ targetLanguage: "hi", contentType: "poetry", segments: [{ id: "a", text: "Rain" }] });
    expect(out.brief?.contentType).toBe("poetry");
    expect(model.calls[1]!.user).toContain("This is verse");
  });

  it("rejects bad requests", async () => {
    const ponte = new Ponte({ model: new FakeModel(prefixTranslator) });
    await expect(ponte.translate({ targetLanguage: "xx", segments: [{ id: "a", text: "Hi" }] })).rejects.toBeInstanceOf(PonteError);
    await expect(ponte.translate({ targetLanguage: "hi", segments: [] })).rejects.toThrow(/non-empty/);
    await expect(
      ponte.translate({ targetLanguage: "hi", segments: [{ id: "a", text: "x" }, { id: "a", text: "y" }] }),
    ).rejects.toThrow(/duplicate/);
  });
});

describe("helpers", () => {
  it("detects scripts", () => {
    expect(scriptCandidates("नमस्ते दुनिया")).toEqual(["hi", "mr"]);
    expect(scriptCandidates("こんにちは世界")).toEqual(["ja"]);
    expect(scriptCandidates("你好世界")).toEqual(["zh", "ja"]);
    expect(scriptCandidates("வணக்கம்")).toEqual(["ta"]);
    expect(scriptCandidates("Hello")).toContain("en");
  });

  it("knows what not to translate", () => {
    for (const t of ["2024", "→", "https://lalityakrishnan.in", "hello@example.com", "  ", "01 / 04"]) {
      expect(isUntranslatable(t)).toBe(true);
    }
    expect(isUntranslatable("Hello")).toBe(false);
  });

  it("validates marker preservation", () => {
    const ok = { id: "a", sourceLanguage: "en", action: "translated" as const, translation: "⟦1⟧यहाँ ⟦0⟧पढ़ें" };
    expect(validateTranslation("⟦0⟧Read ⟦1⟧here", ok)).toBeNull();
    expect(validateTranslation("⟦0⟧Read ⟦1⟧here", { ...ok, translation: "यहाँ पढ़ें" })).toMatch(/markers/);
    expect(validateTranslation("Hi", { ...ok, translation: " " })).toMatch(/empty/);
  });

  it("chunks by size", () => {
    const segs = [100, 100, 100].map((n, i) => ({ id: String(i), text: "x".repeat(n) }));
    expect(chunkSegments(segs, 250).map((c) => c.length)).toEqual([2, 1]);
  });
});

describe("strictSchema", async () => {
  const { strictSchema } = await import("../src/core/model.js");
  const { BRIEF_SCHEMA, TRANSLATION_SCHEMA } = await import("../src/core/prompts.js");
  it("closes every object, requires all properties and drops unsupported constraints", () => {
    const s = strictSchema({
      type: "object",
      properties: { n: { type: "integer", minimum: 1, maximum: 5 }, list: { type: "array", items: { type: "object", properties: { a: { type: "string" } } } } },
      required: ["n"],
    }) as any;
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["n", "list"]);
    expect(s.properties.n).toEqual({ type: "integer" });
    expect(s.properties.list.items.additionalProperties).toBe(false);
    expect(s.properties.list.items.required).toEqual(["a"]);
  });
  it("works on Ponte's schemas", () => {
    const b = strictSchema(BRIEF_SCHEMA) as any;
    expect(b.properties.glossary.items.required).toEqual(["term", "treatment", "rendering"]);
    const t = strictSchema(TRANSLATION_SCHEMA) as any;
    expect(t.properties.results.items.additionalProperties).toBe(false);
  });
});

describe("translating into the page's own language", () => {
  it("only sends text written in another script (e.g. Hindi poems on an English page)", async () => {
    const model = new FakeModel(prefixTranslator);
    const out = await new Ponte({ model }).translate({
      targetLanguage: "en",
      sourceLanguage: "en",
      segments: [
        { id: "a", text: "About me" },
        { id: "poem", text: "शाम की चाय में\nमाँ ने आज फिर" },
      ],
    });
    expect(segmentsIn(model.calls[1]!).map((s) => s.id)).toEqual(["poem"]);
    expect(out.results.map((r) => r.status)).toEqual(["unchanged", "translated"]);
  });
});

describe("text in another script is never silently kept", () => {
  it("retries poem lines the model marked 'unchanged' when translating into the page language", async () => {
    let call = 0;
    const model = new FakeModel((c) => {
      if (c.toolName === "write_brief") return BRIEF;
      call++;
      return {
        results: segmentsIn(c).map((s) => ({
          id: s.id, sourceLanguage: "hi",
          action: call === 1 ? "unchanged" : "translated",
          translation: call === 1 ? s.text : `EN:${s.text}`,
        })),
      };
    });
    const out = await new Ponte({ model }).translate({
      targetLanguage: "en", sourceLanguage: "en",
      segments: [{ id: "l1", text: "कड़कती धूप को भी मैं तो वापस भेज देता हूँ," }, { id: "t", text: "धूप छाँव" }],
    });
    expect(out.results.map((r) => r.status)).toEqual(["translated", "unchanged"]); // the short title may stay
    expect(model.calls.at(-1)!.user).toContain("Do not mark any of them");
  });

  it("allows short titles to stay as written", async () => {
    const { leftInOtherScript } = await import("../src/core/agent.js");
    expect(leftInOtherScript("धूप छाँव", "en")).toBe(false);
    expect(leftInOtherScript("कड़कती धूप को भी मैं तो वापस भेज देता हूँ,", "en")).toBe(true);
    expect(leftInOtherScript("Hello there my friend", "en")).toBe(false);
  });
});
