// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { shareUrl } from "../widget/embed.js";

describe("share link", () => {
  it("opens the same page in the chosen language", () => {
    expect(shareUrl("https://lalityakrishnan.in/work/careone", "hi")).toBe("https://lalityakrishnan.in/work/careone?lang=hi");
  });
  it("replaces an older language and keeps other parameters, dropping the #anchor", () => {
    expect(shareUrl("https://lalityakrishnan.in/?lang=ta&ref=x#top", "bn")).toBe("https://lalityakrishnan.in/?lang=bn&ref=x");
  });
});
