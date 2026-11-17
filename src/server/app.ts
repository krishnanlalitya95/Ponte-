import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { LANGUAGES, Ponte, PonteError, type TranslateRequest } from "../core/index.js";

export interface ServerConfig {
  allowedOrigins: string[];
  maxSegments: number;
  maxChars: number;
  rateLimitPerMin: number;
  /** Absolute paths of static files served by the dev server. */
  widgetPath: string;
  demoPath: string;
}

export function configFromEnv(root: string): ServerConfig {
  return {
    allowedOrigins: (process.env.PONTE_ALLOWED_ORIGINS ?? "http://localhost:8787")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    maxSegments: Number(process.env.PONTE_MAX_SEGMENTS ?? 400),
    maxChars: Number(process.env.PONTE_MAX_CHARS ?? 60000),
    rateLimitPerMin: Number(process.env.PONTE_RATE_LIMIT_PER_MIN ?? 20),
    widgetPath: `${root}/dist/ponte-widget.js`,
    demoPath: `${root}/demo/index.html`,
  };
}

/** "https://*.framer.app" matches "https://my-site.framer.app". */
export function originAllowed(origin: string, allowed: string[]): boolean {
  return allowed.some((pattern) => {
    if (pattern === "*") return true;
    if (!pattern.includes("*")) return pattern === origin;
    const re = new RegExp("^" + pattern.split("*").map(escapeRe).join("[^/]+") + "$");
    return re.test(origin);
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly perMin: number) {}
  allow(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.perMin) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
    return true;
  }
}

export function createHandler(ponte: Ponte, config: ServerConfig) {
  const limiter = new RateLimiter(config.rateLimitPerMin);

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    const url = new URL(req.url ?? "/", "http://localhost");

    if (origin) {
      if (!originAllowed(origin, config.allowedOrigins)) {
        return json(res, 403, { error: `Origin ${origin} is not allowed. Add it to PONTE_ALLOWED_ORIGINS.` });
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true, service: "ponte" });
      }
      if (req.method === "GET" && url.pathname === "/v1/languages") {
        return json(res, 200, { languages: LANGUAGES });
      }
      if (req.method === "GET" && url.pathname === "/widget.js") {
        return file(res, config.widgetPath, "text/javascript; charset=utf-8");
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/demo")) {
        return file(res, config.demoPath, "text/html; charset=utf-8");
      }
      if (req.method === "POST" && url.pathname === "/v1/channels/framer/translate") {
        const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.socket.remoteAddress || "?";
        if (!limiter.allow(ip)) return json(res, 429, { error: "Too many requests. Try again in a minute." });

        const body = (await readJson(req, 1_000_000)) as TranslateRequest;
        if (!body || typeof body !== "object") throw new PonteError("Body must be a JSON object");
        if (!Array.isArray(body.segments)) throw new PonteError("segments must be an array");
        if (body.segments.length > config.maxSegments) {
          throw new PonteError(`Too many segments (${body.segments.length} > ${config.maxSegments}). Send the page in batches.`, 413);
        }
        const chars = body.segments.reduce((n, s) => n + (typeof s?.text === "string" ? s.text.length : 0), 0);
        if (chars > config.maxChars) {
          throw new PonteError(`Too much text (${chars} > ${config.maxChars} characters). Send the page in batches.`, 413);
        }
        const started = Date.now();
        const out = await ponte.translate(body);
        const fallbacks = out.results.filter((r) => r.status === "fallback").length;
        console.log(
          `[ponte] ${out.targetLanguage} ${body.segments.length} segs, ${out.brief.contentType}, ` +
            `${out.usage.modelCalls} calls, ${out.usage.cachedSegments} cached, ${fallbacks} fallback, ${Date.now() - started}ms`,
        );
        return json(res, 200, out);
      }
      return json(res, 404, { error: "Not found" });
    } catch (e) {
      if (e instanceof PonteError) return json(res, e.status, { error: e.message });
      console.error("[ponte] error", e);
      const message = e instanceof Error ? e.message : String(e);
      return json(res, 502, { error: "Translation failed", detail: message });
    }
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function file(res: ServerResponse, path: string, type: string): Promise<void> {
  try {
    const data = await readFile(path);
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(data);
  } catch {
    json(res, 404, { error: `Missing ${path}. Run npm run build:widget.` });
  }
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new PonteError("Request body too large", 413);
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PonteError("Body is not valid JSON");
  }
}
