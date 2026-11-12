/**
 * Browser-ready IIFE stub for Framer Custom Code / Embed.
 * Mirrors ponte-visitor-widget.ts without a bundler step.
 *
 * <script>
 *   window.PONTE_CONFIG = { baseUrl: "http://127.0.0.1:3000", defaultTarget: "hi" };
 * </script>
 * <script src="…/ponte-visitor-widget.iife.js"></script>
 */
(() => {
  const LANGUAGE_OPTIONS = [
    ["hi", "Hindi"],
    ["bn", "Bengali"],
    ["ta", "Tamil"],
    ["te", "Telugu"],
    ["mr", "Marathi"],
    ["gu", "Gujarati"],
    ["kn", "Kannada"],
    ["ml", "Malayalam"],
    ["pa", "Punjabi"],
    ["en", "English"],
    ["es", "Spanish"],
    ["fr", "French"],
    ["de", "German"],
    ["pt", "Portuguese"],
    ["ja", "Japanese"],
    ["zh", "Chinese"],
    ["ar", "Arabic"],
    ["ko", "Korean"],
  ];

  function authHeaders(authToken) {
    const headers = { "content-type": "application/json" };
    if (authToken) {
      headers.authorization = `Bearer ${authToken}`;
      headers["x-agent-alias-token"] = authToken;
    }
    return headers;
  }

  function buildMessage(req) {
    const lines = [
      "Translate these Framer plain-text segments for in-place replacement.",
      `Target language code: ${req.targetLanguage}`,
    ];
    if (req.pageContext) lines.push(`Page context: ${req.pageContext}`);
    lines.push(
      "Detect language and content type, translate meaning-first, then call submit_replacements with every segment id preserved.",
      "",
      "Segments (JSON):",
      JSON.stringify(req.segments, null, 2),
    );
    return lines.join("\n");
  }

  function collectSegments(root) {
    const marked = Array.from(root.querySelectorAll("[data-ponte-id]"));
    if (marked.length) {
      return marked
        .map((el) => ({
          id: el.getAttribute("data-ponte-id") || "",
          text: (el.textContent || "").trim(),
        }))
        .filter((s) => s.id && s.text);
    }
    const segments = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let index = 0;
    let node = walker.nextNode();
    while (node) {
      const text = (node.textContent || "").trim();
      const parent = node.parentElement;
      if (
        text &&
        parent &&
        !["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE"].includes(parent.tagName)
      ) {
        const id = `auto-${index++}`;
        parent.setAttribute("data-ponte-id", id);
        segments.push({ id, text });
      }
      node = walker.nextNode();
    }
    return segments;
  }

  function applyReplacements(root, replacements) {
    let applied = 0;
    for (const item of replacements) {
      const el = root.querySelector(
        `[data-ponte-id="${CSS.escape(item.id)}"]`,
      );
      if (!el) continue;
      el.textContent = item.translated;
      applied += 1;
    }
    return applied;
  }

  function extractBatch(events) {
    let batch = null;
    let sessionId = "";
    for (const event of events) {
      if (event.sessionId) sessionId = event.sessionId;
      if (
        event.type === "action.result" &&
        event.data &&
        event.data.name === "submit_replacements" &&
        event.data.input &&
        event.data.input.replacements
      ) {
        batch = event.data.input;
      }
    }
    if (!batch) return null;
    return { sessionId, ...batch };
  }

  async function translateBatch(req) {
    const baseUrl = req.baseUrl.replace(/\/$/, "");
    const start = await fetch(`${baseUrl}/v1/session`, {
      method: "POST",
      headers: authHeaders(req.authToken),
      body: JSON.stringify({
        message: buildMessage(req),
        title: `Framer → ${req.targetLanguage}`,
      }),
    });
    const body = await start.json();
    if (!start.ok || !body.sessionId) {
      throw new Error(body.message || body.error || "Failed to start session");
    }
    const started = Date.now();
    while (Date.now() - started < 120000) {
      const eventsRes = await fetch(
        `${baseUrl}/v1/session/${body.sessionId}/events?format=json`,
        { headers: authHeaders(req.authToken) },
      );
      const payload = await eventsRes.json();
      const batch = extractBatch(payload.events || []);
      if (batch && batch.replacements) return batch;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Timed out waiting for Ponte");
  }

  function ensurePanel() {
    let root = document.getElementById("ponte-visitor-widget");
    if (root) {
      return {
        select: root.querySelector("select"),
        button: root.querySelector("button"),
        status: root.querySelector("[data-ponte-status]"),
      };
    }
    root = document.createElement("div");
    root.id = "ponte-visitor-widget";
    root.setAttribute(
      "style",
      "position:fixed;right:16px;bottom:16px;z-index:2147483646;display:flex;gap:8px;align-items:center;padding:10px 12px;background:rgba(28,42,36,0.92);color:#f7f3ea;font:13px/1.3 Georgia,serif;border:1px solid rgba(247,243,234,0.25);",
    );
    const brand = document.createElement("span");
    brand.textContent = "Ponte";
    const select = document.createElement("select");
    select.setAttribute(
      "style",
      "font:inherit;background:#f7f3ea;color:#1c2a24;border:0;padding:4px 6px;",
    );
    for (const [code, label] of LANGUAGE_OPTIONS) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = label;
      select.appendChild(opt);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Translate";
    button.setAttribute(
      "style",
      "font:inherit;background:#f7f3ea;color:#1c2a24;border:0;padding:6px 10px;cursor:pointer;",
    );
    const status = document.createElement("span");
    status.dataset.ponteStatus = "1";
    status.style.opacity = "0.8";
    root.append(brand, select, button, status);
    document.body.appendChild(root);
    return { select, button, status };
  }

  function mount(config) {
    const resolved = Object.assign(
      {
        baseUrl: "http://127.0.0.1:3000",
        defaultTarget: "hi",
        pageContext: "Framer portfolio",
        rootSelector: "body",
      },
      window.PONTE_CONFIG || {},
      config || {},
    );
    const panel = ensurePanel();
    const nav = (navigator.language || "").slice(0, 2).toLowerCase();
    panel.select.value = LANGUAGE_OPTIONS.some((x) => x[0] === nav)
      ? nav
      : resolved.defaultTarget;
    panel.button.onclick = async () => {
      const scope =
        document.querySelector(resolved.rootSelector) || document.body;
      const segments = collectSegments(scope);
      if (!segments.length) {
        panel.status.textContent = "No plain text found";
        return;
      }
      panel.status.textContent = "Working…";
      panel.button.disabled = true;
      try {
        const result = await translateBatch({
          baseUrl: resolved.baseUrl,
          authToken: resolved.authToken,
          targetLanguage: panel.select.value,
          pageContext: resolved.pageContext,
          segments,
        });
        const applied = applyReplacements(scope, result.replacements);
        panel.status.textContent = `${applied}/${result.replacements.length} updated`;
      } catch (error) {
        panel.status.textContent = error.message || "Failed";
      } finally {
        panel.button.disabled = false;
      }
    };
  }

  window.PonteWidget = { mount };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mount());
  } else {
    mount();
  }
})();
