// @vitest-environment jsdom
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPonte, textHash } from "../widget/engine.js";
import { _resetLoadedFonts, fontFor } from "../widget/fonts.js";
import { buildStatic } from "../scripts/build-static.js";
import { fingerprint, type LanguageFile } from "../src/core/store.js";

function publish(maps: Record<string, Record<string, string>>) {
  const fetchMock = vi.fn(async (url: string) => {
    const m = /\/t\/(\w+)\.json$/.exec(url);
    const map = m ? maps[m[1]!] : undefined;
    return map ? new Response(JSON.stringify(map), { status: 200 }) : new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  _resetLoadedFonts();
  document.head.innerHTML = "";
  document.body.innerHTML = `
    <h1 style="font-family: Georgia, serif">Monsoon letters</h1>
    <p style="font-family: Inter, sans-serif">Read the <a href="/x">full write-up</a></p>
    <p>New paragraph nobody has translated</p>`;
});
afterEach(() => vi.unstubAllGlobals());

describe("static mode", () => {
  it("applies published translations without any server, leaving unpublished text as is", async () => {
    const fetchMock = publish({
      hi: {
        [textHash("Monsoon letters")]: "मानसून के ख़त",
        [textHash("⟦0⟧Read the ⟦1⟧full write-up")]: "⟦1⟧पूरा विवरण ⟦0⟧पढ़ें",
      },
    });
    const statuses: unknown[] = [];
    const ponte = createPonte({ staticBase: "https://me.github.io/Ponte-/", observe: false, onStatus: (s) => statuses.push(s) });
    await ponte.translate("hi");
    expect(document.querySelector("h1")!.textContent).toBe("मानसून के ख़त");
    expect(document.querySelector("a")!.textContent).toBe("पूरा विवरण");
    expect(document.querySelectorAll("p")[1]!.textContent).toBe("New paragraph nobody has translated");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://me.github.io/Ponte-/t/hi.json");
    expect(statuses.at(-1)).toMatchObject({ state: "done", translated: 2, missing: 1 });

    ponte.restore();
    await ponte.translate("hi");
    expect(fetchMock).toHaveBeenCalledTimes(1); // file fetched once per page view
  });

  it("asks the server only for unpublished text when both are configured", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body: string }) => {
      calls.push(url);
      if (url.endsWith("/t/hi.json")) return new Response(JSON.stringify({ [textHash("Monsoon letters")]: "मानसून के ख़त" }));
      const body = JSON.parse(init!.body);
      return new Response(JSON.stringify({ results: body.segments.map((s: { id: string }) => ({ id: s.id, text: "सर्वर", status: "translated" })) }));
    }));
    await createPonte({ staticBase: "https://s", endpoint: "https://api", observe: false }).translate("hi");
    expect(calls).toEqual(["https://s/t/hi.json", "https://api/v1/channels/framer/translate"]);
    expect(document.querySelector("h1")!.textContent).toBe("मानसून के ख़त");
    expect(document.querySelectorAll("p")[1]!.textContent).toBe("सर्वर");
  });

  it("does nothing harmful when a language isn't published", async () => {
    publish({});
    await createPonte({ staticBase: "https://s", observe: false }).translate("ta");
    expect(document.querySelector("h1")!.textContent).toBe("Monsoon letters");
  });
});

describe("matching fonts", () => {
  it("adds the Noto font that matches each element (serif heading, sans paragraph) and restores on Original", async () => {
    publish({
      hi: {
        [textHash("Monsoon letters")]: "मानसून के ख़त",
        [textHash("⟦0⟧Read the ⟦1⟧full write-up")]: "⟦0⟧पढ़ें ⟦1⟧पूरा विवरण",
      },
    });
    const ponte = createPonte({ staticBase: "https://s", observe: false });
    await ponte.translate("hi");
    const h1 = document.querySelector("h1")!;
    const p = document.querySelector("p")!;
    expect(h1.style.fontFamily.replace(/"/g, "")).toBe("Georgia, Noto Serif Devanagari, serif");
    expect(p.style.fontFamily.replace(/"/g, "")).toBe("Inter, Noto Sans Devanagari, sans-serif");
    const links = [...document.head.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href"));
    expect(links).toEqual([
      "https://fonts.googleapis.com/css2?family=Noto+Serif+Devanagari:wght@400;500;600;700&display=swap",
      "https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap",
    ]);

    ponte.restore();
    expect(h1.style.fontFamily).toBe("Georgia, serif");
    expect(p.style.fontFamily).toBe("Inter, sans-serif");
  });

  it("switches script fonts between languages and adds none for Latin languages", async () => {
    publish({ ta: { [textHash("Monsoon letters")]: "பருவமழை கடிதங்கள்" }, es: { [textHash("Monsoon letters")]: "Cartas del monzón" } });
    const ponte = createPonte({ staticBase: "https://s", observe: false });
    await ponte.translate("ta");
    expect(document.querySelector("h1")!.style.fontFamily.replace(/"/g, "")).toBe("Georgia, Noto Serif Tamil, serif");
    await ponte.translate("es");
    expect(document.querySelector("h1")!.style.fontFamily).toBe("Georgia, serif");
  });

  it("can be turned off", async () => {
    publish({ hi: { [textHash("Monsoon letters")]: "मानसून के ख़त" } });
    await createPonte({ staticBase: "https://s", observe: false, fonts: false }).translate("hi");
    expect(document.querySelector("h1")!.style.fontFamily).toBe("Georgia, serif");
    expect(document.head.querySelector("link")).toBeNull();
  });

  it("puts the script font before the generic fallback", async () => {
    const { withScriptFont } = await import("../widget/engine.js");
    expect(withScriptFont('"Inter", "Inter Placeholder", sans-serif', "Noto Sans Tamil")).toBe('"Inter", "Inter Placeholder", "Noto Sans Tamil", sans-serif');
    expect(withScriptFont("Georgia", "Noto Serif JP")).toBe('Georgia, "Noto Serif JP"');
    expect(withScriptFont("", "Noto Sans KR")).toBe('"Noto Sans KR"');
    expect(withScriptFont("system-ui, sans-serif", "Noto Sans Tamil")).toBe('system-ui, "Noto Sans Tamil", sans-serif');
    expect(withScriptFont('Georgia, "Noto Serif Devanagari", serif', "Noto Serif Devanagari")).toBe('Georgia, "Noto Serif Devanagari", serif');
  });

  it("picks serif vs sans from the element's font", () => {
    expect(fontFor("hi", '"Instrument Serif", "Instrument Serif Placeholder", serif')).toBe("Noto Serif Devanagari");
    expect(fontFor("hi", '"Inter", "Inter Placeholder", sans-serif')).toBe("Noto Sans Devanagari");
    expect(fontFor("hi", '"DM Sans", sans-serif')).toBe("Noto Sans Devanagari");
    expect(fontFor("hi", '"Playfair Display"')).toBe("Noto Serif Devanagari");
    expect(fontFor("hi", "")).toBe("Noto Sans Devanagari");
    expect(fontFor("ja", "Georgia")).toBe("Noto Serif JP");
    expect(fontFor("es", "Georgia")).toBeNull();
  });
});

describe("static build", () => {
  it("turns saved translation files into the files the widget reads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ponte-static-"));
    await mkdir(join(dir, "translations"));
    await mkdir(join(dir, "..", "dist"), { recursive: true }).catch(() => {});
    const file: LanguageFile = {
      [fingerprint("Monsoon letters")]: { source: "Monsoon letters", text: "मानसून के ख़त", status: "translated", sourceLanguage: "en", savedAt: "x" },
    };
    await writeFile(join(dir, "translations", "hi.json"), JSON.stringify(file));
    await writeFile(join(dir, "translations", "notes.txt"), "ignored");
    const res = await buildStatic(join(dir, "translations"), join(dir, "public"));
    expect(res.languages).toEqual([{ code: "hi", name: "Hindi", entries: 1 }]);
    const out = JSON.parse(await readFile(join(dir, "public", "t", "hi.json"), "utf8"));
    expect(out).toEqual({ [textHash("Monsoon letters")]: "मानसून के ख़त" });
    const idx = JSON.parse(await readFile(join(dir, "public", "t", "index.json"), "utf8"));
    expect(idx.languages[0].code).toBe("hi");
    expect((await readFile(join(dir, "public", "widget.js"), "utf8")).length).toBeGreaterThan(1000);
  });

  it("publishes only the languages currently offered", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ponte-static-"));
    await mkdir(join(dir, "translations"));
    const file = (src: string, text: string): LanguageFile => ({
      [fingerprint(src)]: { source: src, text, status: "translated", sourceLanguage: "en", savedAt: "x" },
    });
    await writeFile(join(dir, "translations", "hi.json"), JSON.stringify(file("Hi", "नमस्ते")));
    await writeFile(join(dir, "translations", "es.json"), JSON.stringify(file("Hi", "Hola")));
    const res = await buildStatic(join(dir, "translations"), join(dir, "public"), ["en", "hi"]);
    expect(res.languages.map((l) => l.code)).toEqual(["hi"]);
  });
});

describe("page language as a real choice (mixed-language pages)", () => {
  it("switching Hindi → English shows English text as written and the Hindi poem in English", async () => {
    document.body.innerHTML = `
      <h1>About me</h1>
      <p class="poem">शाम की चाय में</p>`;
    publish({
      hi: { [textHash("About me")]: "मेरे बारे में" },
      en: { [textHash("शाम की चाय में")]: "In the evening tea" },
    });
    const ponte = createPonte({ staticBase: "https://s", sourceLanguage: "en", observe: false });
    await ponte.translate("hi");
    expect(document.querySelector("h1")!.textContent).toBe("मेरे बारे में");
    expect(document.querySelector(".poem")!.textContent).toBe("शाम की चाय में");
    await ponte.translate("en");
    expect(document.querySelector("h1")!.textContent).toBe("About me"); // back to as written, not stuck in Hindi
    expect(document.querySelector(".poem")!.textContent).toBe("In the evening tea");
    expect(localStorage.getItem("ponte:language")).toBe("en");
  });

  it("text with no published translation in the new language returns to the original", async () => {
    publish({ hi: { [textHash("Monsoon letters")]: "मानसून के ख़त" }, ta: {} });
    const ponte = createPonte({ staticBase: "https://s", observe: false });
    await ponte.translate("hi");
    await ponte.translate("ta");
    expect(document.querySelector("h1")!.textContent).toBe("Monsoon letters");
    expect(document.querySelector("h1")!.style.fontFamily).toBe("Georgia, serif");
  });

  it("a remembered page-language choice is kept only when a translation into it is published", async () => {
    const { initialLanguage } = await import("../widget/engine.js");
    localStorage.setItem("ponte:language", "en");
    expect(initialLanguage({ available: ["en", "hi"], source: "en", languages: ["hi"] })).toBe("en");
    expect(initialLanguage({ available: ["hi"], source: "en", languages: ["hi"] })).toBeNull();
    localStorage.clear();
    // Default for an English reader stays "as written", even when English is published.
    expect(initialLanguage({ available: ["en", "hi"], source: "en", languages: ["en-IN"] })).toBeNull();
  });
});
