// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPonte, splitMarkers } from "../widget/engine.js";

type Seg = { id: string; text: string; role?: string };

function mockServer(translate: (s: Seg, lang: string) => string) {
  const requests: Array<{ targetLanguage: string; segments: Seg[] }> = [];
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    return new Response(
      JSON.stringify({
        targetLanguage: body.targetLanguage,
        brief: {},
        results: body.segments.map((s: Seg) => ({ id: s.id, text: translate(s, body.targetLanguage), status: "translated", sourceLanguage: "en" })),
        usage: {},
        model: "fake",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}

const upper = (s: Seg) => s.text.replace(/(⟦\d+⟧)?([^⟦]*)/g, (_m, mk = "", t: string) => mk + t.toUpperCase());

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = `
    <nav><a href="#">Work</a><a href="#">About</a></nav>
    <h1 data-ponte-id="hero">  Calm software  </h1>
    <p id="mixed">Read the <a href="/x">full write-up</a> and <strong>three ideas</strong>.</p>
    <p>2024</p>
    <pre>const x = 1</pre>
    <div data-ponte-skip><p>Leave me</p></div>
    <script>var notText = 1</script>`;
});
afterEach(() => vi.unstubAllGlobals());

describe("visitor engine", () => {
  it("collects plain text blocks, skipping code, scripts and opted-out areas", async () => {
    const { requests } = mockServer(upper);
    const ponte = createPonte({ endpoint: "http://api", observe: false });
    await ponte.translate("hi");
    const sent = requests[0]!.segments;
    expect(sent.map((s) => s.text)).toEqual([
      "Work",
      "About",
      "Calm software",
      "⟦0⟧Read the ⟦1⟧full write-up ⟦2⟧and ⟦3⟧three ideas⟦4⟧.",
      "2024",
    ]);
    expect(sent.find((s) => s.text === "Calm software")!.id).toBe("hero");
    expect(sent[0]!.role).toBe("a in nav");
  });

  it("replaces text in place, keeping links, whitespace and inline elements", async () => {
    mockServer(upper);
    const ponte = createPonte({ endpoint: "http://api", observe: false });
    await ponte.translate("hi");
    expect(document.querySelector("h1")!.textContent).toBe("  CALM SOFTWARE  ");
    const p = document.getElementById("mixed")!;
    expect(p.querySelector("a")!.textContent).toBe("FULL WRITE-UP");
    expect(p.querySelector("a")!.getAttribute("href")).toBe("/x");
    expect(p.textContent).toBe("READ THE FULL WRITE-UP AND THREE IDEAS.");
    expect(document.querySelector("pre")!.textContent).toBe("const x = 1");
    expect(document.querySelector("[data-ponte-skip] p")!.textContent).toBe("Leave me");
  });

  it("handles reordered markers (target grammar)", async () => {
    document.body.innerHTML = `<p>Read <a href="#">here</a></p>`;
    mockServer(() => "⟦1⟧यहाँ ⟦0⟧पढ़ें");
    await createPonte({ endpoint: "http://api", observe: false }).translate("hi");
    expect(document.querySelector("a")!.textContent).toBe("यहाँ");
    expect(document.querySelector("p")!.textContent).toBe("पढ़ें यहाँ");
  });

  it("restores the original text and switches languages from the originals", async () => {
    const { requests } = mockServer((s, lang) => `${lang}:${s.text}`);
    const ponte = createPonte({ endpoint: "http://api", observe: false });
    await ponte.translate("hi");
    expect(document.querySelector("h1")!.textContent!.trim()).toBe("hi:Calm software");
    await ponte.translate("ta");
    expect(document.querySelector("h1")!.textContent!.trim()).toBe("ta:Calm software");
    expect(requests[1]!.segments.some((s) => s.text.startsWith("hi:"))).toBe(false);
    ponte.restore();
    expect(document.querySelector("h1")!.textContent).toBe("  Calm software  ");
    expect(localStorage.getItem("ponte:language")).toBe("original");
  });

  it("re-applies from cache without a network call", async () => {
    const { fetchMock } = mockServer(upper);
    const ponte = createPonte({ endpoint: "http://api", observe: false });
    await ponte.translate("hi");
    ponte.restore();
    await ponte.translate("hi");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector("h1")!.textContent!.trim()).toBe("CALM SOFTWARE");
  });

  it("translates content that appears later (Framer re-renders, lazy sections)", async () => {
    const { requests } = mockServer(upper);
    const ponte = createPonte({ endpoint: "http://api" });
    await ponte.translate("hi");
    const p = document.createElement("p");
    p.textContent = "New section";
    document.body.append(p);
    await vi.waitFor(() => expect(p.textContent).toBe("NEW SECTION"), { timeout: 2000 });
    expect(requests[1]!.segments.map((s) => s.text)).toEqual(["New section"]);
    ponte.destroy();
  });

  it("sets dir=rtl on translated blocks for Arabic and removes it on restore", async () => {
    mockServer(() => "مرحبا");
    const ponte = createPonte({ endpoint: "http://api", observe: false });
    await ponte.translate("ar");
    expect(document.querySelector("h1")!.getAttribute("dir")).toBe("rtl");
    ponte.restore();
    expect(document.querySelector("h1")!.hasAttribute("dir")).toBe(false);
  });

  it("reports server errors through status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Origin not allowed" }), { status: 403 })));
    const statuses: string[] = [];
    await createPonte({ endpoint: "http://api", observe: false, onStatus: (s) => statuses.push(s.error ?? s.state) }).translate("hi");
    expect(statuses).toEqual(["translating", "Origin not allowed"]);
    expect(document.querySelector("h1")!.textContent).toBe("  Calm software  ");
  });
});

describe("browser copy (return visits)", () => {
  it("shows the saved copy instantly on a new page load, then re-checks quietly", async () => {
    mockServer(upper);
    await createPonte({ endpoint: "http://api", observe: false }).translate("hi");
    await new Promise((r) => setTimeout(r, 250)); // let the browser copy save

    // New page load: fresh DOM + fresh engine; server is slow and has an improved version.
    document.body.innerHTML = `<h1>Calm software</h1>`;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      await gate;
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ results: body.segments.map((s: Seg) => ({ id: s.id, text: "Calm Software (edited)", status: "translated" })) }), { status: 200 });
    }));
    const statuses: string[] = [];
    const p = createPonte({ endpoint: "http://api", observe: false, onStatus: (s) => statuses.push(s.state) }).translate("hi");
    await Promise.resolve();
    expect(document.querySelector("h1")!.textContent).toBe("CALM SOFTWARE"); // instant, before the server answers
    expect(statuses).toEqual(["done"]); // no "Translating…" flash
    release();
    await p;
    expect(document.querySelector("h1")!.textContent).toBe("Calm Software (edited)"); // picks up your edit
  });

  it("keeps showing the saved copy if the server is unreachable", async () => {
    mockServer(upper);
    await createPonte({ endpoint: "http://api", observe: false }).translate("hi");
    await new Promise((r) => setTimeout(r, 250));
    document.body.innerHTML = `<h1>Calm software</h1>`;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const statuses: string[] = [];
    await createPonte({ endpoint: "http://api", observe: false, onStatus: (s) => statuses.push(s.state) }).translate("hi");
    expect(document.querySelector("h1")!.textContent).toBe("CALM SOFTWARE");
    expect(statuses).toEqual(["done"]);
  });
});

describe("splitMarkers", () => {
  it("splits by index and rejects missing markers", () => {
    expect(splitMarkers("⟦0⟧a ⟦1⟧b", 2)).toEqual(["a ", "b"]);
    expect(splitMarkers("⟦1⟧b ⟦0⟧a", 2)).toEqual(["a", "b "]);
    expect(splitMarkers("⟦0⟧a", 2)).toBeNull();
    expect(splitMarkers("⟦0⟧a ⟦0⟧b", 2)).toBeNull();
  });
});

describe("visitor language detection", async () => {
  const { initialLanguage, pageLanguage } = await import("../widget/engine.js");
  const base = { available: ["hi", "ta", "es"], source: "en" };

  it("opens in the visitor's device language when it's published", () => {
    expect(initialLanguage({ ...base, languages: ["hi-IN", "en-US"] })).toBe("hi");
    expect(initialLanguage({ ...base, languages: ["es-MX"] })).toBe("es");
  });

  it("keeps the original when the visitor reads the page's language first, or theirs isn't published", () => {
    expect(initialLanguage({ ...base, languages: ["en-IN", "hi"] })).toBeNull();
    expect(initialLanguage({ ...base, languages: ["de-DE", "fr"] })).toBeNull();
    expect(initialLanguage({ ...base, languages: ["hi"], auto: false })).toBeNull();
  });

  it("respects the visitor's own choice, including choosing the original", () => {
    localStorage.setItem("ponte:language", "ta");
    expect(initialLanguage({ ...base, languages: ["hi"] })).toBe("ta");
    localStorage.setItem("ponte:language", "original");
    expect(initialLanguage({ ...base, languages: ["hi"] })).toBeNull();
  });

  it("remembers 'Original' after restore so auto-detect doesn't flip it back", async () => {
    mockServer(upper);
    const ponte = createPonte({ endpoint: "http://api", observe: false });
    await ponte.translate("hi");
    ponte.restore();
    expect(localStorage.getItem("ponte:language")).toBe("original");
    expect(initialLanguage({ ...base, languages: ["hi"] })).toBeNull();
  });

  it("reads the page language from <html lang>", () => {
    document.documentElement.setAttribute("lang", "en-GB");
    expect(pageLanguage()).toBe("en");
    expect(pageLanguage("hi")).toBe("hi");
  });
});
