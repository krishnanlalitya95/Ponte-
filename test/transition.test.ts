// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPonte, textHash } from "../widget/engine.js";
import { parseColor, snapSwap } from "../widget/snap.js";

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = `<h1>Monsoon letters</h1><p>Not published yet</p>`;
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    new Response(JSON.stringify(url.endsWith("/t/hi.json") ? { [textHash("Monsoon letters")]: "मानसून के ख़त" } : {})),
  ));
});
afterEach(() => vi.unstubAllGlobals());

describe("language switch transition", () => {
  it("runs only for picks marked animate, and gets every affected block", async () => {
    const transition = vi.fn((_els: Element[], swap: () => void) => swap());
    const ponte = createPonte({ staticBase: "https://s", observe: false, transition });
    await ponte.translate("hi");
    expect(transition).not.toHaveBeenCalled();
    await ponte.translate("en", { animate: true });
    await ponte.translate("hi", { animate: true });
    expect(transition).toHaveBeenCalledTimes(2);
    expect(transition.mock.calls[1]![0].map((e) => e.tagName)).toEqual(["H1", "P"]);
    expect(document.querySelector("h1")!.textContent).toBe("मानसून के ख़त");
  });

  it("still switches the language if the transition breaks or forgets to swap", async () => {
    const ponte = createPonte({ staticBase: "https://s", observe: false, transition: () => { throw new Error("boom"); } });
    await ponte.translate("hi", { animate: true });
    expect(document.querySelector("h1")!.textContent).toBe("मानसून के ख़त");
    document.body.innerHTML = `<h1>Monsoon letters</h1>`;
    const lazy = createPonte({ staticBase: "https://s", observe: false, transition: () => {} });
    await lazy.translate("hi", { animate: true });
    expect(document.querySelector("h1")!.textContent).toBe("मानसून के ख़त");
  });

  it("dust always swaps the text, and skips animating when nothing is on screen (jsdom has no layout)", () => {
    const swap = vi.fn();
    snapSwap([document.querySelector("h1")!], swap);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("reads colours for the dust", () => {
    expect(parseColor("rgb(255, 0, 16)")).toBe(0x1000ff);
    expect(parseColor("#3A8D25")).toBe(0x258d3a);
    expect(parseColor("rgba(0, 0, 0, 0)")).toBeNull();
  });
});
