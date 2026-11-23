// @vitest-environment jsdom
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildStatic } from "../scripts/build-static.js";
import { fingerprint, type LanguageFile } from "../src/core/store.js";
import { chunkWordSegments, cleanGlosses, wordsCall } from "../src/core/words.js";
import { MockModelClient } from "../src/core/mock.js";
import { createPonte, textHash } from "../widget/engine.js";
import { defaultTarget, findGloss, mountWordLookup, type Gloss } from "../widget/words.js";

const SRC = "Most of my work lives where people are having a bad day — a claim that's gone quiet.";
const HI = "मेरा ज़्यादातर काम वहाँ होता है जहाँ लोगों का दिन ख़राब चल रहा होता है — ऐसा क्लेम जिसका जवाब आना बंद हो गया हो।";

describe("preparing word lookups", () => {
  it("keeps only words that are really in the texts, drops duplicates and wrong matches", () => {
    const words = cleanGlosses(
      [
        { s: "lives", t: "होता है", c: "होता है", d: "जीना, रहना" },
        { s: "Lives", t: "", c: "x", d: "y" }, // duplicate
        { s: "gone quiet", t: "जवाब आना बंद", c: "जवाब आना बंद हो गया", d: "" },
        { s: "dragon", t: "", c: "ड्रैगन", d: "" }, // not in the text
        { s: "claim", t: "दावा", c: "क्लेम", d: "दावा" }, // "दावा" isn't in the Hindi text
        { s: "work", t: "", c: "", d: "" }, // no meaning
      ],
      SRC,
      HI,
    );
    expect(words).toEqual([
      { s: "lives", t: "होता है", c: "होता है", d: "जीना, रहना" },
      { s: "gone quiet", t: "जवाब आना बंद", c: "जवाब आना बंद हो गया", d: "" },
      { s: "claim", t: "", c: "क्लेम", d: "दावा" },
    ]);
  });

  it("sends the original without ⟦markers⟧ next to the language's version, in size-limited requests", () => {
    const call = wordsCall("hi", [{ id: "a", source: "⟦0⟧Read the ⟦1⟧full write-up", shown: "⟦1⟧पूरा विवरण ⟦0⟧पढ़ें" }], "everyday");
    expect(call.user).toContain('"original": "Read the full write-up"');
    expect(call.user).toContain('"hi": "पूरा विवरण पढ़ें"');
    expect(call.system).toContain("IN THIS SENTENCE");
    expect(call.system).toContain("प्रयोक्ता"); // everyday-language notes for Hindi
    const segs = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, source: "x".repeat(400), shown: "y" }));
    expect(chunkWordSegments(segs, 1500).map((c) => c.length)).toEqual([3, 3, 3, 1]);
  });

  it("works offline with the mock model", async () => {
    const r = await new MockModelClient().structured<{ results: Array<{ id: string; words: unknown[] }> }>(
      wordsCall("ta", [{ id: "a", source: "Monsoon letters", shown: "Monsoon letters" }]),
    );
    expect(r.data.results[0]!.words).toHaveLength(2);
  });

  it("publishes compact word files for offered languages and lists them in the index", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ponte-words-"));
    await mkdir(join(dir, "translations"));
    const entry = (words: LanguageFile[string]["words"]): LanguageFile => ({
      [fingerprint(SRC)]: { source: SRC, text: HI, status: "translated", sourceLanguage: "en", savedAt: "x", settings: "words-v1:x", words },
    });
    await writeFile(join(dir, "translations", "words-hi.json"), JSON.stringify(entry([{ s: "lives", t: "होता है", c: "होता है", d: "जीना" }])));
    await writeFile(join(dir, "translations", "words-en.json"), JSON.stringify(entry([{ s: "lives", t: "lives", c: "is found", d: "is alive" }])));
    await writeFile(join(dir, "translations", "words-es.json"), JSON.stringify(entry([{ s: "lives", t: "", c: "está", d: "vive" }])));
    const res = await buildStatic(join(dir, "translations"), join(dir, "public"), ["en", "hi"]);
    expect(res.words).toEqual(["en", "hi"]);
    const hi = JSON.parse(await readFile(join(dir, "public", "t", "words", "hi.json"), "utf8"));
    expect(hi).toEqual({ [textHash(SRC)]: [["lives", "होता है", "होता है", "जीना"]] });
    const idx = JSON.parse(await readFile(join(dir, "public", "t", "index.json"), "utf8"));
    expect(idx.words).toEqual(["en", "hi"]);
  });
});

describe("finding the selected word", () => {
  const list: Gloss[] = [
    ["lives", "होता है", "होता है", "जीना, रहना"],
    ["bad day", "दिन ख़राब", "बुरा दिन", "बुरा दिन"],
    ["claim", "क्लेम", "क्लेम", "दावा"],
    ["gone quiet", "जवाब आना बंद", "जवाब आना बंद हो गया", ""],
  ];
  it("matches exact words, ignoring case and punctuation around them", () => {
    expect(findGloss(list, "Claim,", 0)?.[0]).toBe("claim");
    expect(findGloss(list, "क्लेम", 1)?.[0]).toBe("claim");
  });
  it("finds the phrase a single selected word belongs to, and the phrase inside a longer selection", () => {
    expect(findGloss(list, "quiet", 0)?.[0]).toBe("gone quiet");
    expect(findGloss(list, "बंद", 1)?.[0]).toBe("gone quiet");
    expect(findGloss(list, "a bad day", 0)?.[0]).toBe("bad day");
    expect(findGloss(list, "da", 0)).toBeUndefined(); // part of a word isn't a match
  });
  it("starts on Hindi, then English, and remembers the visitor's choice", () => {
    expect(defaultTarget(["hi", "ta", "en"], null)).toBe("hi");
    expect(defaultTarget(["ta", "en"], null)).toBe("en");
    expect(defaultTarget(["hi", "ta", "en"], "ta")).toBe("ta");
    expect(defaultTarget(["hi", "en"], "ta")).toBe("hi");
  });
});

describe("the popup", () => {
  afterEach(() => vi.unstubAllGlobals());
  const files: Record<string, Record<string, Gloss[]>> = {
    en: { [textHash(SRC)]: [["lives", "lives", "is found", "is alive, resides"], ["claim", "claim", "request for money", "demand, assertion"]] },
    hi: { [textHash(SRC)]: [["lives", "होता है", "होता है", "जीना, रहना"], ["claim", "क्लेम", "क्लेम", "दावा"]] },
    ta: { [textHash(SRC)]: [["lives", "", "இருக்கிறது", "வாழ்வது"], ["claim", "", "க்ளெய்ம்", "கோரிக்கை"]] },
  };
  const setup = () => {
    localStorage.clear();
    document.body.innerHTML = `<p>${SRC}</p>`;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const m = /words\/(\w+)\.json$/.exec(url);
      return new Response(JSON.stringify(m ? (files[m[1]!] ?? {}) : {}));
    }));
    const ponte = createPonte({ staticBase: "https://s", observe: false });
    const stop = mountWordLookup({ ponte, base: "https://s", languages: ["en", "hi", "ta"], source: "en" });
    const host = document.body.lastElementChild as HTMLElement;
    const shadow = host.shadowRoot!;
    const select = (word: string) => {
      const text = document.querySelector("p")!.firstChild as Text;
      const i = text.data.indexOf(word);
      const r = document.createRange();
      r.setStart(text, i);
      r.setEnd(text, i + word.length);
      r.getBoundingClientRect = () => new DOMRect(10, 10, 40, 16);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
      document.dispatchEvent(new Event("selectionchange"));
    };
    return { ponte, stop, shadow, select };
  };
  const settle = async () => {
    await vi.advanceTimersByTimeAsync(400);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it("shows Hindi by default with both meanings, leaves out the page's language, and remembers a new choice", async () => {
    vi.useFakeTimers();
    const { shadow, select, stop } = setup();
    select("lives");
    await settle();
    const pop = shadow.querySelector(".p") as HTMLElement;
    expect(pop.hidden).toBe(false);
    const options = [...shadow.querySelectorAll("option")].map((o) => o.value);
    expect(options).toEqual(["hi", "ta"]); // no English: the page is in English
    expect(shadow.querySelector(".c")!.textContent).toBe("होता है");
    expect(shadow.querySelector(".d")!.textContent).toBe("जीना, रहना");
    const sel = shadow.querySelector("select")!;
    sel.value = "ta";
    sel.dispatchEvent(new Event("change"));
    await settle();
    expect(shadow.querySelector(".c")!.textContent).toBe("இருக்கிறது");
    select("claim");
    await settle();
    expect(sel.value).toBe("ta");
    expect(shadow.querySelector(".c")!.textContent).toBe("க்ளெய்ம்");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(pop.hidden).toBe(true);
    stop();
    vi.useRealTimers();
  });

  it("on a page shown in Hindi, finds the Hindi word and offers English (the original) first", async () => {
    vi.useFakeTimers();
    const { ponte, shadow, stop } = setup();
    files.hi_page = {};
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/t/hi.json")) return new Response(JSON.stringify({ [textHash(SRC)]: HI }));
      const m = /words\/(\w+)\.json$/.exec(url);
      return new Response(JSON.stringify(m ? (files[m[1]!] ?? {}) : {}));
    }));
    await ponte.translate("hi");
    expect(document.querySelector("p")!.textContent).toBe(HI);
    const text = document.querySelector("p")!.firstChild as Text;
    const i = text.data.indexOf("क्लेम");
    const r = document.createRange();
    r.setStart(text, i);
    r.setEnd(text, i + "क्लेम".length);
    r.getBoundingClientRect = () => new DOMRect(10, 10, 40, 16);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
    document.dispatchEvent(new Event("selectionchange"));
    await settle();
    expect([...shadow.querySelectorAll("option")].map((o) => o.value)).toEqual(["en", "ta"]);
    expect(shadow.querySelector(".c")!.textContent).toBe("claim"); // the original word
    expect(shadow.querySelector(".d")!.textContent).toBe("demand, assertion");
    stop();
    vi.useRealTimers();
  });

  it("ignores long selections and text outside the page content", async () => {
    vi.useFakeTimers();
    const { shadow, select, stop } = setup();
    select("Most of my work lives where people");
    await settle();
    expect((shadow.querySelector(".p") as HTMLElement).hidden).toBe(true);
    stop();
    vi.useRealTimers();
  });
});
