import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Saved translations.
 *
 * Each translation is saved once per (language, source text) and reused forever after,
 * so a static site is translated by the agent only the first time anyone asks.
 *
 * Files are human-editable: translations/<lang>.json maps a short fingerprint of the
 * source text to { source, text, ... }. Edit "text" to improve a translation; Ponte
 * never overwrites an entry that already exists, so your edit is what visitors see.
 * Change the source text on the site and it gets a new fingerprint (and a fresh
 * translation); delete an entry to force re-translation.
 */
export interface StoredTranslation {
  source: string;
  text: string;
  status: "translated" | "unchanged";
  sourceLanguage: string;
  contentType?: string;
  /** Page where the text was first seen — helps you find it when editing. */
  page?: string;
  model?: string;
  savedAt: string;
  /**
   * Fingerprint of the settings used (author, glossary, keep-as-is terms). When the
   * settings change, the entry is re-translated on the next run — unless locked.
   */
  settings?: string;
  /** Set to true on entries you've edited by hand: Ponte will never replace them. */
  locked?: boolean;
  /** Set by the checker (src/core/review.ts) once this exact text has been checked. */
  checked?: string;
  /** What the checker fixed, kept for your reference. */
  checkNote?: string;
  /** Word lookups (only in translations/words-<lang>.json): see src/core/words.ts. */
  words?: Array<{ s: string; t: string; c: string; d: string }>;
}

/** Whether a new entry may replace an existing one: only when settings changed and it isn't locked. */
export function canReplace(existing: StoredTranslation | undefined, next: StoredTranslation): boolean {
  if (!existing) return true;
  if (existing.locked) return false;
  // A real translation may replace one the agent wrongly left as is.
  if (existing.status === "unchanged" && next.status === "translated") return true;
  // The checker marks (and maybe fixes) an entry it has reviewed.
  if (next.checked !== undefined && existing.checked !== next.checked) return true;
  return next.settings !== undefined && existing.settings !== next.settings;
}

export interface TranslationStore {
  get(lang: string, source: string): Promise<StoredTranslation | undefined>;
  /** Save new entries. Existing entries are replaced only when their settings changed and they aren't locked. */
  put(lang: string, entries: StoredTranslation[]): Promise<void>;
  /** Write anything pending. Call on shutdown. */
  flush(): Promise<void>;
}

export type LanguageFile = Record<string, StoredTranslation>;

/** Fingerprint of a source text. Stable across runs; changes when the text changes. */
export function fingerprint(source: string): string {
  return createHash("sha256").update(source.trim()).digest("hex").slice(0, 16);
}

/** Keeps everything in memory. Default for tests and one-off runs. */
export class MemoryStore implements TranslationStore {
  readonly files = new Map<string, LanguageFile>();
  async get(lang: string, source: string) {
    return this.files.get(lang)?.[fingerprint(source)];
  }
  async put(lang: string, entries: StoredTranslation[]) {
    if (!entries.length) return;
    const file = this.files.get(lang) ?? {};
    for (const e of entries) {
      const k = fingerprint(e.source);
      if (canReplace(file[k], e)) file[k] = e;
    }
    this.files.set(lang, file);
  }
  async flush() {}
}

// ---------------------------------------------------------------------------
// JSON-file store with pluggable backend (local disk or a GitHub branch)
// ---------------------------------------------------------------------------

export interface FileBackend {
  readonly name: string;
  /** Returns the file and an opaque version (sha), or null when it doesn't exist yet. */
  read(lang: string): Promise<{ data: LanguageFile; version: string | null } | null>;
  /** Write the file. Throws ConflictError if `version` is no longer current. Returns the new version. */
  write(lang: string, data: LanguageFile, version: string | null, message: string): Promise<string | null>;
}

export class ConflictError extends Error {}

export interface JsonStoreOptions {
  /** How long a loaded language file is trusted before re-reading (picks up manual edits). */
  refreshMs?: number;
  /** Batch new translations and write them at most this often. */
  flushDelayMs?: number;
  log?: (msg: string) => void;
}

export class JsonFileStore implements TranslationStore {
  private loaded = new Map<string, { data: LanguageFile; version: string | null; at: number }>();
  private loading = new Map<string, Promise<void>>();
  private pending = new Map<string, LanguageFile>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | null = null;
  private readonly refreshMs: number;
  private readonly flushDelayMs: number;
  private readonly log: (msg: string) => void;

  constructor(
    readonly backend: FileBackend,
    opts: JsonStoreOptions = {},
  ) {
    this.refreshMs = opts.refreshMs ?? 5 * 60_000;
    this.flushDelayMs = opts.flushDelayMs ?? 20_000;
    this.log = opts.log ?? ((m) => console.log(`[ponte:store] ${m}`));
  }

  async get(lang: string, source: string): Promise<StoredTranslation | undefined> {
    const key = fingerprint(source);
    const pending = this.pending.get(lang)?.[key];
    if (pending) return pending;
    await this.ensureLoaded(lang);
    return this.loaded.get(lang)?.data[key];
  }

  async put(lang: string, entries: StoredTranslation[]): Promise<void> {
    if (!entries.length) return;
    await this.ensureLoaded(lang);
    const existing = this.loaded.get(lang)?.data ?? {};
    const pending = this.pending.get(lang) ?? {};
    let added = 0;
    for (const e of entries) {
      const key = fingerprint(e.source);
      if (!canReplace(pending[key] ?? existing[key], e)) continue;
      pending[key] = e;
      added++;
    }
    if (!added) return;
    this.pending.set(lang, pending);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush().catch((err) => this.log(`flush failed: ${err instanceof Error ? err.message : err}`));
      }, this.flushDelayMs);
      this.timer.unref?.();
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    while (this.flushing) await this.flushing;
    if (!this.pending.size) return;
    this.flushing = this.doFlush().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    const batches = [...this.pending.entries()];
    this.pending.clear();
    for (const [lang, additions] of batches) {
      try {
        await this.writeMerged(lang, additions);
      } catch (err) {
        // Put them back so the next flush retries.
        const again = this.pending.get(lang) ?? {};
        for (const [k, v] of Object.entries(additions)) if (canReplace(again[k], v)) again[k] = v;
        this.pending.set(lang, again);
        throw err;
      }
    }
  }

  private async writeMerged(lang: string, additions: LanguageFile, attempt = 1): Promise<void> {
    // Always merge into the latest version so manual edits made meanwhile are kept.
    const latest = await this.backend.read(lang);
    const data: LanguageFile = { ...(latest?.data ?? {}) };
    let added = 0;
    for (const [k, v] of Object.entries(additions)) {
      // Re-check against the latest file: a hand edit (locked) made meanwhile always wins.
      if (canReplace(data[k], v)) {
        data[k] = v;
        added++;
      }
    }
    const version = latest?.version ?? null;
    if (!added) {
      this.loaded.set(lang, { data, version, at: Date.now() });
      return;
    }
    try {
      const newVersion = await this.backend.write(lang, data, version, `Save ${added} ${lang} translation${added === 1 ? "" : "s"} [skip ci]`);
      this.loaded.set(lang, { data, version: newVersion, at: Date.now() });
      this.log(`saved ${added} ${lang} translation(s) to ${this.backend.name}`);
    } catch (err) {
      if (err instanceof ConflictError && attempt < 4) return this.writeMerged(lang, additions, attempt + 1);
      throw err;
    }
  }

  private async ensureLoaded(lang: string): Promise<void> {
    const cur = this.loaded.get(lang);
    if (cur && Date.now() - cur.at < this.refreshMs) return;
    let p = this.loading.get(lang);
    if (!p) {
      p = (async () => {
        try {
          const file = await this.backend.read(lang);
          this.loaded.set(lang, { data: file?.data ?? {}, version: file?.version ?? null, at: Date.now() });
        } catch (err) {
          // Keep serving what we had (or nothing) rather than failing the request.
          this.log(`couldn't load ${lang}: ${err instanceof Error ? err.message : err}`);
          this.loaded.set(lang, { data: cur?.data ?? {}, version: cur?.version ?? null, at: Date.now() - this.refreshMs + 30_000 });
        } finally {
          this.loading.delete(lang);
        }
      })();
      this.loading.set(lang, p);
    }
    await p;
  }
}

/** Stable, readable JSON: entries sorted by page then source, 2-space indent. */
export function serialize(data: LanguageFile): string {
  const sorted = Object.entries(data).sort(([, a], [, b]) =>
    (a.page ?? "").localeCompare(b.page ?? "") || a.source.localeCompare(b.source),
  );
  return JSON.stringify(Object.fromEntries(sorted), null, 2) + "\n";
}

function parse(text: string, where: string): LanguageFile {
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not an object");
    return data as LanguageFile;
  } catch (e) {
    throw new Error(`${where} is not valid JSON (${e instanceof Error ? e.message : e}). Fix or revert the last edit.`);
  }
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

export class LocalFileBackend implements FileBackend {
  readonly name: string;
  constructor(private readonly dir: string) {
    this.name = dir;
  }
  private path(lang: string) {
    return join(this.dir, `${lang}.json`);
  }
  async read(lang: string) {
    try {
      const text = await readFile(this.path(lang), "utf8");
      return { data: parse(text, this.path(lang)), version: null };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async write(lang: string, data: LanguageFile) {
    const p = this.path(lang);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(`${p}.tmp`, serialize(data));
    await rename(`${p}.tmp`, p);
    return null;
  }
}

export interface GitHubBackendOptions {
  token: string;
  /** "owner/repo" */
  repo: string;
  /** Branch that holds translations. Created from the default branch if missing. */
  branch: string;
  /** Folder inside the repo. */
  dir: string;
  apiBase?: string;
  fetch?: typeof fetch;
}

/** Saves translation files to a branch of a GitHub repo through the REST contents API. */
export class GitHubBackend implements FileBackend {
  readonly name: string;
  private readonly api: string;
  private readonly f: typeof fetch;
  private branchReady = false;

  constructor(private readonly o: GitHubBackendOptions) {
    this.api = (o.apiBase ?? "https://api.github.com").replace(/\/+$/, "");
    this.f = o.fetch ?? fetch;
    this.name = `github:${o.repo}@${o.branch}/${o.dir}`;
  }

  private async req(path: string, init: RequestInit = {}) {
    return this.f(`${this.api}/repos/${this.o.repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.o.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ponte",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  }

  private filePath(lang: string) {
    return `${this.o.dir.replace(/^\/+|\/+$/g, "")}/${lang}.json`;
  }

  async read(lang: string) {
    const res = await this.req(`/contents/${this.filePath(lang)}?ref=${encodeURIComponent(this.o.branch)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub read ${lang}: HTTP ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { sha: string; content?: string; encoding?: string; download_url?: string };
    let text: string;
    if (body.content && body.encoding === "base64") {
      text = Buffer.from(body.content, "base64").toString("utf8");
    } else {
      // Files over 1 MB come without inline content; fetch the blob instead.
      const blob = await this.req(`/git/blobs/${body.sha}`);
      if (!blob.ok) throw new Error(`GitHub blob ${lang}: HTTP ${blob.status}`);
      text = Buffer.from(((await blob.json()) as { content: string }).content, "base64").toString("utf8");
    }
    this.branchReady = true;
    return { data: parse(text, `${this.filePath(lang)} on ${this.o.branch}`), version: body.sha };
  }

  async write(lang: string, data: LanguageFile, version: string | null, message: string) {
    await this.ensureBranch();
    const res = await this.req(`/contents/${this.filePath(lang)}`, {
      method: "PUT",
      body: JSON.stringify({
        message,
        branch: this.o.branch,
        content: Buffer.from(serialize(data), "utf8").toString("base64"),
        ...(version ? { sha: version } : {}),
      }),
    });
    if (res.status === 409 || res.status === 422) throw new ConflictError(`GitHub write ${lang}: HTTP ${res.status}`);
    if (!res.ok) throw new Error(`GitHub write ${lang}: HTTP ${res.status} ${await res.text()}`);
    return ((await res.json()) as { content: { sha: string } }).content.sha;
  }

  private async ensureBranch() {
    if (this.branchReady) return;
    const has = await this.req(`/git/ref/heads/${encodeURIComponent(this.o.branch)}`);
    if (has.ok) {
      this.branchReady = true;
      return;
    }
    if (has.status !== 404) throw new Error(`GitHub branch check: HTTP ${has.status}`);
    const repo = await this.req("");
    if (!repo.ok) throw new Error(`GitHub repo: HTTP ${repo.status}`);
    const base = ((await repo.json()) as { default_branch: string }).default_branch;
    const ref = await this.req(`/git/ref/heads/${encodeURIComponent(base)}`);
    if (!ref.ok) throw new Error(`GitHub base ref: HTTP ${ref.status}`);
    const sha = ((await ref.json()) as { object: { sha: string } }).object.sha;
    const created = await this.req("/git/refs", {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${this.o.branch}`, sha }),
    });
    if (!created.ok && created.status !== 422) throw new Error(`GitHub create branch: HTTP ${created.status}`);
    this.branchReady = true;
  }
}

/**
 * Pick a store from the environment:
 *   PONTE_STORE=github  (default when PONTE_GITHUB_TOKEN is set) → GitHub branch
 *   PONTE_STORE=file    (default otherwise) → ./translations on disk
 *   PONTE_STORE=memory  → nothing saved
 */
export function storeFromEnv(root: string, env = process.env): TranslationStore {
  const kind = env.PONTE_STORE || (env.PONTE_GITHUB_TOKEN ? "github" : "file");
  const dir = env.PONTE_TRANSLATIONS_DIR || "translations";
  const opts: JsonStoreOptions = {
    refreshMs: env.PONTE_STORE_REFRESH_SEC ? Number(env.PONTE_STORE_REFRESH_SEC) * 1000 : undefined,
    flushDelayMs: env.PONTE_STORE_FLUSH_SEC ? Number(env.PONTE_STORE_FLUSH_SEC) * 1000 : undefined,
  };
  if (kind === "memory") return new MemoryStore();
  if (kind === "github") {
    const token = env.PONTE_GITHUB_TOKEN;
    const repo = env.PONTE_GITHUB_REPO;
    if (!token || !repo) throw new Error("PONTE_STORE=github needs PONTE_GITHUB_TOKEN and PONTE_GITHUB_REPO (owner/repo).");
    return new JsonFileStore(
      new GitHubBackend({ token, repo, branch: env.PONTE_GITHUB_BRANCH || "ponte-translations", dir }),
      opts,
    );
  }
  if (kind === "file") return new JsonFileStore(new LocalFileBackend(join(root, dir)), { flushDelayMs: 2000, ...opts });
  throw new Error(`Unknown PONTE_STORE: ${kind}`);
}
