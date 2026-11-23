import { describe, expect, it } from "vitest";
import { acceptFix, checkCall, checkMark, chunkCheck } from "../src/core/review.js";
import { canReplace, type StoredTranslation } from "../src/core/store.js";
import { EVERYDAY_NOTES, translateSystem } from "../src/core/prompts.js";
import { getLanguage } from "../src/core/languages.js";

const SRC = "⟦0⟧From engineering and ⟦1⟧universal design⟦2⟧ to digital products";
const TA = "⟦0⟧பொறியியல் மற்றும் ⟦1⟧உலகளாவிய வடிவமைப்பு⟦2⟧ முதல் டிஜிட்டல் தயாரிப்புகள் வரை";

describe("independent checker", () => {
  it("tells the reviewer the glossary, the author and the global audience", () => {
    const call = checkCall("ta", "https://x/about", [{ id: "c0", source: SRC, translation: TA }], {
      author: { name: "Lalitya Krishnan", gender: "male" },
      voice: "everyday",
      glossary: { "Universal Design": "யுனிவர்சல் டிசைன்" },
      doNotTranslate: ["GlossAI"],
    });
    expect(call.system).toContain("Universal Design → யுனிவர்சல் டிசைன்");
    expect(call.system).toContain("not \"worldwide design\"");
    expect(call.system).toContain("global audience");
    expect(call.system).toContain("male");
    expect(call.system).toContain("GlossAI");
    expect(call.user).toContain('"ta": "' + TA);
  });

  it("accepts a fix only when it keeps every formatting marker and actually changes something", () => {
    const seg = { id: "c0", source: SRC, translation: TA };
    const good = TA.replace("உலகளாவிய வடிவமைப்பு", "யுனிவர்சல் டிசைன்");
    expect(acceptFix(seg, { id: "c0", verdict: "fix", fixed: good }, "ta")).toBe(good);
    expect(acceptFix(seg, { id: "c0", verdict: "fix", fixed: good.replace("⟦1⟧", "") }, "ta")).toBeNull();
    expect(acceptFix(seg, { id: "c0", verdict: "fix", fixed: TA }, "ta")).toBeNull();
    expect(acceptFix(seg, { id: "c0", verdict: "ok" }, "ta")).toBeNull();
  });

  it("can update a checked entry, but never a hand-locked one", () => {
    const e: StoredTranslation = { source: "a", text: "b", status: "translated", sourceLanguage: "en", savedAt: "x", settings: "s1" };
    expect(canReplace(e, { ...e, checked: checkMark("b") })).toBe(true);
    expect(canReplace({ ...e, checked: checkMark("b") }, { ...e, checked: checkMark("b") })).toBe(false);
    expect(canReplace({ ...e, locked: true }, { ...e, text: "c", checked: checkMark("c") })).toBe(false);
  });

  it("groups translations into size-limited requests", () => {
    const segs = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, source: "x".repeat(1200), translation: "y" }));
    expect(chunkCheck(segs, 3000).map((c) => c.length)).toEqual([2, 2, 1]);
  });
});

describe("global-audience rules", () => {
  it("language notes don't anchor on one city, and Tamil/Bengali notes name all their readers", () => {
    expect(Object.values(EVERYDAY_NOTES).join(" ")).not.toMatch(/Mumbai|Delhi|Pune|Bengaluru|Kolkata|Ahmedabad/);
    expect(EVERYDAY_NOTES.ta).toContain("Sri Lanka");
    expect(EVERYDAY_NOTES.bn).toContain("Bangladesh");
  });
  it("tells every translator that field and job names are terms, not phrases", () => {
    expect(translateSystem(getLanguage("ja")!, "everyday")).toContain("Universal Design");
    expect(translateSystem(getLanguage("ja")!)).toContain("never translate them word by word");
  });
});
