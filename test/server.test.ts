import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Ponte } from "../src/core/agent.js";
import { createHandler, originAllowed, type ServerConfig } from "../src/server/app.js";
import { FakeModel, prefixTranslator } from "./fake-model.js";

let server: Server;
let base: string;
const config: ServerConfig = {
  allowedOrigins: ["https://lalityakrishnan.in", "https://*.framer.app"],
  maxSegments: 5,
  maxChars: 200,
  rateLimitPerMin: 100,
  widgetPath: "/nonexistent/widget.js",
  demoPath: "/nonexistent/demo.html",
};

beforeAll(async () => {
  server = createServer(createHandler(new Ponte({ model: new FakeModel(prefixTranslator) }), config));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const post = (body: unknown, origin?: string) =>
  fetch(`${base}/v1/channels/framer/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });

describe("Framer channel API", () => {
  it("translates and sets CORS for allowed origins", async () => {
    const res = await post({ targetLanguage: "hi", segments: [{ id: "a", text: "Hello" }] }, "https://my-site.framer.app");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://my-site.framer.app");
    const data = await res.json();
    expect(data.results[0]).toMatchObject({ id: "a", text: "HI:Hello", status: "translated" });
  });

  it("blocks unknown origins", async () => {
    const res = await post({ targetLanguage: "hi", segments: [{ id: "a", text: "Hello" }] }, "https://evil.example");
    expect(res.status).toBe(403);
  });

  it("enforces size limits and validates input", async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: String(i), text: "x" }));
    expect((await post({ targetLanguage: "hi", segments: many })).status).toBe(413);
    expect((await post({ targetLanguage: "hi", segments: [{ id: "a", text: "x".repeat(201) }] })).status).toBe(413);
    expect((await post({ targetLanguage: "klingon", segments: [{ id: "a", text: "x" }] })).status).toBe(400);
    const bad = await fetch(`${base}/v1/channels/framer/translate`, { method: "POST", body: "{not json" });
    expect(bad.status).toBe(400);
  });

  it("lists languages and answers preflight", async () => {
    const langs = await (await fetch(`${base}/v1/languages`)).json();
    expect(langs.languages.map((l: { code: string }) => l.code)).toEqual(expect.arrayContaining(["hi", "ta", "ja", "ar"]));
    const pre = await fetch(`${base}/v1/channels/framer/translate`, { method: "OPTIONS", headers: { Origin: "https://lalityakrishnan.in" } });
    expect(pre.status).toBe(204);
  });

  it("matches wildcard origins safely", () => {
    expect(originAllowed("https://a.framer.app", ["https://*.framer.app"])).toBe(true);
    expect(originAllowed("https://a.framer.app.evil.com", ["https://*.framer.app"])).toBe(false);
    expect(originAllowed("https://evil.com/.framer.app", ["https://*.framer.app"])).toBe(false);
  });
});
