/**
 * Minimal Ponte HTTP client for Framer embeds.
 * Works against `agent-sdk serve --mode single` or a hosted alias URL.
 */

export type PonteSegment = {
  id: string;
  text: string;
};

export type PonteReplacement = {
  id: string;
  original: string;
  translated: string;
};

export type TranslateBatchRequest = {
  baseUrl: string;
  targetLanguage: string;
  sourceLanguage?: string;
  pageContext?: string;
  segments: PonteSegment[];
  /** Optional bearer / alias token for non-loopback hosts. */
  authToken?: string;
  /** Prefer the Framer custom channel (202 + poll) or the session API. */
  mode?: "session" | "channel";
};

export type TranslateBatchResult = {
  sessionId: string;
  sourceLanguage?: string;
  targetLanguage: string;
  contentType?: string;
  replacements: PonteReplacement[];
  replyText?: string;
};

type SessionStartResponse = {
  ok?: boolean;
  sessionId?: string;
  continuationToken?: string;
  error?: string;
  message?: string;
};

function authHeaders(authToken?: string): HeadersInit {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (authToken) {
    headers.authorization = `Bearer ${authToken}`;
    headers["x-agent-alias-token"] = authToken;
  }
  return headers;
}

function buildSessionMessage(req: TranslateBatchRequest): string {
  const lines = [
    "Translate these Framer plain-text segments for in-place replacement.",
    `Target language code: ${req.targetLanguage}`,
  ];
  if (req.sourceLanguage) {
    lines.push(`Hinted source language: ${req.sourceLanguage}`);
  }
  if (req.pageContext) {
    lines.push(`Page context: ${req.pageContext}`);
  }
  lines.push(
    "Detect language and content type, translate meaning-first, then call submit_replacements with every segment id preserved.",
    "",
    "Segments (JSON):",
    JSON.stringify(req.segments, null, 2),
  );
  return lines.join("\n");
}

function extractReplacements(events: unknown[]): TranslateBatchResult | null {
  let sessionId = "";
  let replyText = "";
  let batch: {
    sourceLanguage?: string;
    targetLanguage?: string;
    contentType?: string;
    replacements?: PonteReplacement[];
  } | null = null;

  for (const event of events) {
    const row = event as {
      type?: string;
      sessionId?: string;
      data?: {
        text?: string;
        name?: string;
        output?: unknown;
        input?: unknown;
      };
    };
    if (row.sessionId) sessionId = row.sessionId;
    if (row.type === "message.completed" && row.data?.text) {
      replyText = row.data.text;
    }
    if (
      row.type === "action.result" &&
      row.data?.name === "submit_replacements"
    ) {
      const output = row.data.output as { ok?: boolean } | undefined;
      const input = row.data.input as typeof batch;
      if (input?.replacements) batch = input;
      if (output && !input) {
        // keep waiting for input echo if only ack arrived
      }
    }
  }

  if (!batch?.replacements?.length || !batch.targetLanguage) return null;
  return {
    sessionId,
    sourceLanguage: batch.sourceLanguage,
    targetLanguage: batch.targetLanguage,
    contentType: batch.contentType,
    replacements: batch.replacements,
    replyText,
  };
}

async function readSessionEvents(
  baseUrl: string,
  sessionId: string,
  authToken?: string,
): Promise<unknown[]> {
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/v1/session/${sessionId}/events?format=json`,
    { headers: authHeaders(authToken) },
  );
  if (!response.ok) {
    throw new Error(`Failed to read session events (${response.status})`);
  }
  const payload = (await response.json()) as { events?: unknown[] };
  return payload.events ?? [];
}

async function waitForReplacements(
  baseUrl: string,
  sessionId: string,
  authToken?: string,
  timeoutMs = 120_000,
): Promise<TranslateBatchResult> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const events = await readSessionEvents(baseUrl, sessionId, authToken);
    const result = extractReplacements(events);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for Ponte submit_replacements");
}

/**
 * Start a translation batch via the built-in session API, then poll events
 * until `submit_replacements` lands.
 */
export async function translateBatch(
  req: TranslateBatchRequest,
): Promise<TranslateBatchResult> {
  const baseUrl = req.baseUrl.replace(/\/$/, "");
  const mode = req.mode ?? "session";

  if (mode === "channel") {
    const response = await fetch(`${baseUrl}/v1/channels/framer/translate`, {
      method: "POST",
      headers: authHeaders(req.authToken),
      body: JSON.stringify({
        targetLanguage: req.targetLanguage,
        sourceLanguage: req.sourceLanguage,
        pageContext: req.pageContext,
        segments: req.segments,
      }),
    });
    if (response.status !== 202 && !response.ok) {
      throw new Error(`Framer channel error (${response.status})`);
    }
    // Hosted/custom channel opens a session the caller may not see in the
    // 202 body. Prefer mode:"session" for embed polling; channel mode is
    // for fire-and-forget / relay setups.
    throw new Error(
      "Channel mode returned 202; use mode:\"session\" for embed polling, or wire a relay that reads the session stream.",
    );
  }

  const start = await fetch(`${baseUrl}/v1/session`, {
    method: "POST",
    headers: authHeaders(req.authToken),
    body: JSON.stringify({
      message: buildSessionMessage(req),
      title: `Framer → ${req.targetLanguage}`,
    }),
  });
  const body = (await start.json()) as SessionStartResponse;
  if (!start.ok || !body.sessionId) {
    throw new Error(body.message || body.error || "Failed to start session");
  }
  return waitForReplacements(baseUrl, body.sessionId, req.authToken);
}

/** Apply replacements onto DOM text nodes keyed by data-ponte-id. */
export function applyReplacementsInPlace(
  root: ParentNode,
  replacements: PonteReplacement[],
): number {
  let applied = 0;
  for (const item of replacements) {
    const node = root.querySelector(`[data-ponte-id="${CSS.escape(item.id)}"]`);
    if (!node) continue;
    node.textContent = item.translated;
    applied += 1;
  }
  return applied;
}

/** Collect plain-text candidates: elements marked data-ponte-id, else text-ish leaves. */
export function collectPlainTextSegments(
  root: ParentNode,
): PonteSegment[] {
  const marked = Array.from(
    root.querySelectorAll<HTMLElement>("[data-ponte-id]"),
  );
  if (marked.length > 0) {
    return marked
      .map((el) => ({
        id: el.getAttribute("data-ponte-id") || "",
        text: (el.textContent || "").trim(),
      }))
      .filter((segment) => segment.id && segment.text);
  }

  const segments: PonteSegment[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let index = 0;
  let current = walker.nextNode();
  while (current) {
    const text = (current.textContent || "").trim();
    const parent = current.parentElement;
    if (
      text &&
      parent &&
      !["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE"].includes(parent.tagName)
    ) {
      const id = `auto-${index++}`;
      parent.setAttribute("data-ponte-id", id);
      segments.push({ id, text });
    }
    current = walker.nextNode();
  }
  return segments;
}
