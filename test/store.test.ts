import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Ponte } from "../src/core/agent.js";
import {
  ConflictError,
  GitHubBackend,
  JsonFileStore,
  LocalFileBackend,
  MemoryStore,
  fingerprint,
  type FileBackend,
  type LanguageFile,
  type StoredTranslation,
} from "../src/core/store.js";
import { FakeModel, prefixTranslator } from "./fake-model.js";

const entry = (source: string, text: string): StoredTranslation => ({
  source,
  text,
  status: "translated",
  sourceLanguage: "en",
  savedAt: "2026-11-17T00:00:00Z",
});

describe("saved translations in the agent", () => {
  it("translates once, then serves saved text with zero agent calls", async () => {
    const model = new FakeModel(prefixTranslator);
    const store = new MemoryStore();
    const first = new Ponte({ model, store });
    await first.translate({ targetLanguage: "hi", context: { url: "https://site/" }, segments: [{ id: "a", text: "Hello" }, { id: "b", text: "World" }] });
    expect(model.calls).toHaveLength(2);

    // A new server process (fresh Ponte) with the same store: nothing goes to the agent.
    const second = new Ponte({ model, store });
    const out = await second.translate({ targetLanguage: "hi", segments: [{ id: "x", text: "World" }, { id: "y", text: "Hello" }] });
    expect(model.calls).toHaveLength(2);
    expect(out.brief).toBeNull();
    expect(out.results).toEqual([
      expect.objectContaining({ id: "x", text: "HI:World", status: "translated", saved: true }),
      expect.objectContaining({ id: "y", text: "HI:Hello", status: "translated", saved: true }),
    ]);
    expect(out.usage).toMatchObject({ storedSegments: 2, modelCalls: 0 });
    expect(store.files.get("hi")![fingerprint("Hello")]).toMatchObject({ source: "Hello", page: "https://site/", model: "fake-model" });
  });

  it("only sends new or changed text to the agent", async () => {
    const model = new FakeModel(prefixTranslator);
    const store = new MemoryStore();
    await store.put("hi", [entry("Kept paragraph", "पहले से सहेजा")]);
    const out = await new Ponte({ model, store }).translate({
      targetLanguage: "hi",
      segments: [{ id: "a", text: "Kept paragraph" }, { id: "b", text: "Edited paragraph" }],
    });
    const sent = model.calls.filter((c) => c.toolName === "submit_translations").map((c) => c.user);
    expect(sent.join()).toContain("Edited paragraph");
    expect(sent.join()).not.toContain('"text":"Kept paragraph"');
    expect(out.results.map((r) => r.text)).toEqual(["पहले से सहेजा", "HI:Edited paragraph"]);
  });

  it("never saves fallbacks, so failed text is retried later", async () => {
    const model = new FakeModel((c) => (c.toolName === "write_brief" ? prefixTranslator(c) : new Error("down")));
    const store = new MemoryStore();
    await new Ponte({ model, store }).translate({ targetLanguage: "hi", segments: [{ id: "a", text: "Hello" }] });
    expect(store.files.get("hi")).toBeUndefined();
  });

  it("keeps translations per language", async () => {
    const store = new MemoryStore();
    await store.put("hi", [entry("Hello", "नमस्ते")]);
    expect(await store.get("ta", "Hello")).toBeUndefined();
    expect((await store.get("hi", "  Hello ")) ?.text).toBe("नमस्ते"); // surrounding whitespace ignored
  });
});

describe("JSON file store", () => {
  it("writes readable files and never overwrites an existing (possibly hand-edited) entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ponte-"));
    const store = new JsonFileStore(new LocalFileBackend(dir), { flushDelayMs: 10_000, log: () => {} });
    await store.put("hi", [entry("Rain", "बारिश")]);
    await store.flush();

    // Lalitya edits the file by hand…
    const path = join(dir, "hi.json");
    const file = JSON.parse(await readFile(path, "utf8")) as LanguageFile;
    file[fingerprint("Rain")]!.text = "बरखा";
    await writeFile(path, JSON.stringify(file, null, 2));

    // …a new process loads it, and an agent re-translation of the same text doesn't clobber it.
    const fresh = new JsonFileStore(new LocalFileBackend(dir), { log: () => {} });
    expect((await fresh.get("hi", "Rain"))?.text).toBe("बरखा");
    await fresh.put("hi", [entry("Rain", "बारिश"), entry("Window", "खिड़की")]);
    await fresh.flush();
    const after = JSON.parse(await readFile(path, "utf8")) as LanguageFile;
    expect(after[fingerprint("Rain")]!.text).toBe("बरखा");
    expect(after[fingerprint("Window")]!.text).toBe("खिड़की");
    expect(await readFile(path, "utf8")).toContain('"source": "Window"');
  });

  it("merges into the latest version when the file changed meanwhile, retrying on conflict", async () => {
    let remote: LanguageFile = {};
    let version = 0;
    let conflictsLeft = 1;
    const backend: FileBackend = {
      name: "fake",
      async read() {
        return { data: structuredClone(remote), version: String(version) };
      },
      async write(_lang, data, v) {
        if (conflictsLeft-- > 0) {
          // Someone edits the file between our read and write.
          remote[fingerprint("Edited elsewhere")] = entry("Edited elsewhere", "X");
          version++;
          throw new ConflictError("409");
        }
        if (v !== String(version)) throw new ConflictError("stale");
        remote = data;
        return String(++version);
      },
    };
    const store = new JsonFileStore(backend, { log: () => {} });
    await store.put("hi", [entry("Mine", "मेरा")]);
    await store.flush();
    expect(Object.values(remote).map((e) => e.source).sort()).toEqual(["Edited elsewhere", "Mine"]);
  });

  it("re-reads the file after the refresh window so manual edits go live", async () => {
    let text = "पहला";
    const backend: FileBackend = {
      name: "fake",
      async read() {
        return { data: { [fingerprint("Hi")]: entry("Hi", text) }, version: "1" };
      },
      async write() {
        return "2";
      },
    };
    const store = new JsonFileStore(backend, { refreshMs: 0, log: () => {} });
    expect((await store.get("hi", "Hi"))?.text).toBe("पहला");
    text = "दूसरा";
    expect((await store.get("hi", "Hi"))?.text).toBe("दूसरा");
  });

  it("keeps pending translations if a write fails, and saves them on the next flush", async () => {
    let fail = true;
    let saved: LanguageFile | null = null;
    const backend: FileBackend = {
      name: "fake",
      async read() {
        return null;
      },
      async write(_l, data) {
        if (fail) throw new Error("network");
        saved = data;
        return "1";
      },
    };
    const store = new JsonFileStore(backend, { log: () => {} });
    await store.put("hi", [entry("A", "ए")]);
    await expect(store.flush()).rejects.toThrow("network");
    expect((await store.get("hi", "A"))?.text).toBe("ए"); // still served from pending
    fail = false;
    await store.flush();
    expect(Object.keys(saved!)).toEqual([fingerprint("A")]);
  });
});

describe("GitHub backend", () => {
  function fakeGitHub() {
    const files = new Map<string, { content: string; sha: string }>();
    const branches = new Set(["main"]);
    const calls: string[] = [];
    let n = 0;
    const f = (async (url: string, init: RequestInit = {}) => {
      const u = new URL(url);
      const method = init.method ?? "GET";
      calls.push(`${method} ${u.pathname}${u.search}`);
      const path = u.pathname.replace("/repos/me/site", "");
      const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (path === "") return ok({ default_branch: "main" });
      if (path.startsWith("/git/ref/heads/")) {
        const b = decodeURIComponent(path.slice("/git/ref/heads/".length));
        return branches.has(b) ? ok({ object: { sha: "base" } }) : ok({}, 404);
      }
      if (path === "/git/refs" && method === "POST") {
        branches.add(JSON.parse(String(init.body)).ref.replace("refs/heads/", ""));
        return ok({}, 201);
      }
      if (path.startsWith("/contents/")) {
        const key = path.slice("/contents/".length);
        if (method === "GET") {
          const file = files.get(key);
          return file ? ok({ sha: file.sha, content: file.content, encoding: "base64" }) : ok({}, 404);
        }
        const body = JSON.parse(String(init.body));
        if (!branches.has(body.branch)) return ok({}, 404);
        const cur = files.get(key);
        if ((cur?.sha ?? undefined) !== body.sha) return ok({}, 409);
        const sha = `s${++n}`;
        files.set(key, { content: body.content, sha });
        return ok({ content: { sha } });
      }
      return ok({}, 404);
    }) as unknown as typeof fetch;
    return { f, files, branches, calls };
  }

  it("creates the translations branch on first save, then updates the file in place", async () => {
    const gh = fakeGitHub();
    const backend = new GitHubBackend({ token: "t", repo: "me/site", branch: "ponte-translations", dir: "translations", fetch: gh.f });
    const store = new JsonFileStore(backend, { log: () => {} });
    expect(await store.get("hi", "Hello")).toBeUndefined();
    await store.put("hi", [entry("Hello", "नमस्ते")]);
    await store.flush();
    expect(gh.branches.has("ponte-translations")).toBe(true);
    await store.put("hi", [entry("World", "दुनिया")]);
    await store.flush();

    const file = gh.files.get("translations/hi.json")!;
    const data = JSON.parse(Buffer.from(file.content, "base64").toString("utf8")) as LanguageFile;
    expect(Object.values(data).map((e) => e.text).sort()).toEqual(["दुनिया", "नमस्ते"]);
    expect(gh.calls.filter((c) => c.startsWith("PUT"))).toHaveLength(2);

    // A fresh server reads it back from GitHub.
    const fresh = new JsonFileStore(new GitHubBackend({ token: "t", repo: "me/site", branch: "ponte-translations", dir: "translations", fetch: gh.f }), { log: () => {} });
    expect((await fresh.get("hi", "World"))?.text).toBe("दुनिया");
  });
});
