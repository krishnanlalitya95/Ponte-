/**
 * Visitor-facing Ponte widget for published Framer pages.
 *
 * Paste as a Framer embed / custom code snippet. It injects a language
 * picker, finds plain-text nodes (prefer `[data-ponte-id]`), calls the
 * Ponte session API, and replaces copy in place.
 *
 * Configure before load:
 *   window.PONTE_CONFIG = {
 *     baseUrl: "https://<alias>.agents.cursor.com/ponte", // or local serve
 *     authToken: "", // alias token when required
 *     defaultTarget: "hi",
 *     pageContext: "Portfolio",
 *   }
 */
import {
  applyReplacementsInPlace,
  collectPlainTextSegments,
  translateBatch,
} from "./ponte-client";

export type PonteWidgetConfig = {
  baseUrl: string;
  authToken?: string;
  defaultTarget?: string;
  pageContext?: string;
  rootSelector?: string;
};

declare global {
  interface Window {
    PONTE_CONFIG?: PonteWidgetConfig;
    PonteWidget?: { mount: (config?: PonteWidgetConfig) => void };
  }
}

const LANGUAGE_OPTIONS: Array<{ code: string; label: string }> = [
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "mr", label: "Marathi" },
  { code: "gu", label: "Gujarati" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "pa", label: "Punjabi" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "ja", label: "Japanese" },
  { code: "zh", label: "Chinese" },
  { code: "ar", label: "Arabic" },
  { code: "ko", label: "Korean" },
];

function detectVisitorLanguage(fallback: string): string {
  const nav = (navigator.language || "").slice(0, 2).toLowerCase();
  if (LANGUAGE_OPTIONS.some((option) => option.code === nav)) return nav;
  return fallback;
}

function ensurePanel(): {
  root: HTMLDivElement;
  select: HTMLSelectElement;
  button: HTMLButtonElement;
  status: HTMLSpanElement;
} {
  const existing = document.getElementById("ponte-visitor-widget");
  if (existing) {
    return {
      root: existing as HTMLDivElement,
      select: existing.querySelector("select") as HTMLSelectElement,
      button: existing.querySelector("button") as HTMLButtonElement,
      status: existing.querySelector("[data-ponte-status]") as HTMLSpanElement,
    };
  }

  const root = document.createElement("div");
  root.id = "ponte-visitor-widget";
  root.setAttribute(
    "style",
    [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483646",
      "display:flex",
      "gap:8px",
      "align-items:center",
      "padding:10px 12px",
      "background:rgba(28,42,36,0.92)",
      "color:#f7f3ea",
      "font:13px/1.3 Georgia, serif",
      "border:1px solid rgba(247,243,234,0.25)",
    ].join(";"),
  );

  const label = document.createElement("span");
  label.textContent = "Ponte";
  label.style.letterSpacing = "0.06em";

  const select = document.createElement("select");
  select.setAttribute(
    "style",
    "font:inherit;background:#f7f3ea;color:#1c2a24;border:0;padding:4px 6px;",
  );
  for (const option of LANGUAGE_OPTIONS) {
    const node = document.createElement("option");
    node.value = option.code;
    node.textContent = option.label;
    select.appendChild(node);
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
  status.textContent = "";

  root.append(label, select, button, status);
  document.body.appendChild(root);
  return { root, select, button, status };
}

export function mount(config?: PonteWidgetConfig): void {
  const resolved: PonteWidgetConfig = {
    baseUrl: "http://127.0.0.1:3000",
    defaultTarget: "hi",
    pageContext: "Framer portfolio",
    rootSelector: "body",
    ...window.PONTE_CONFIG,
    ...config,
  };

  const panel = ensurePanel();
  panel.select.value = detectVisitorLanguage(resolved.defaultTarget || "hi");

  panel.button.onclick = async () => {
    const scope =
      document.querySelector(resolved.rootSelector || "body") || document.body;
    const segments = collectPlainTextSegments(scope);
    if (!resolved.baseUrl) {
      panel.status.textContent = "Missing baseUrl";
      return;
    }
    if (segments.length === 0) {
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
        mode: "session",
      });
      const applied = applyReplacementsInPlace(scope, result.replacements);
      panel.status.textContent = `${applied}/${result.replacements.length} updated`;
    } catch (error) {
      panel.status.textContent =
        error instanceof Error ? error.message : "Failed";
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
