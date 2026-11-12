/**
 * Framer code component (author/editor).
 *
 * Drop on a page, set target language + agent base URL, bind or paste
 * plain-text blocks. On Translate, Ponte returns replacements and this
 * component swaps bound text in place.
 *
 * Install: copy into a Framer code file, or publish from this repo's
 * `framer/` folder once the agent URL is deployed.
 */
import * as React from "react";
import { addPropertyControls, ControlType } from "framer";
import {
  applyReplacementsInPlace,
  translateBatch,
  type PonteSegment,
} from "./ponte-client";

type Props = {
  baseUrl: string;
  targetLanguage: string;
  authToken: string;
  pageContext: string;
  /** Newline-separated `id|text` rows, or plain lines auto-id'd. */
  textBlocks: string;
  buttonLabel: string;
};

function parseBlocks(raw: string): PonteSegment[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const pipe = line.indexOf("|");
      if (pipe > 0) {
        return {
          id: line.slice(0, pipe).trim(),
          text: line.slice(pipe + 1).trim(),
        };
      }
      return { id: `block-${index + 1}`, text: line };
    })
    .filter((segment) => segment.text.length > 0);
}

export default function PonteTranslate(props: Props) {
  const [status, setStatus] = React.useState("Idle");
  const [preview, setPreview] = React.useState(props.textBlocks);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const onTranslate = React.useCallback(async () => {
    const segments = parseBlocks(props.textBlocks);
    if (!props.baseUrl) {
      setStatus("Set Agent base URL");
      return;
    }
    if (segments.length === 0) {
      setStatus("Add plain-text blocks");
      return;
    }
    setStatus("Translating…");
    try {
      const result = await translateBatch({
        baseUrl: props.baseUrl,
        targetLanguage: props.targetLanguage || "hi",
        pageContext: props.pageContext || undefined,
        authToken: props.authToken || undefined,
        segments,
        mode: "session",
      });
      const lines = result.replacements.map(
        (item) => `${item.id}|${item.translated}`,
      );
      setPreview(lines.join("\n"));
      if (rootRef.current) {
        for (const item of result.replacements) {
          const el = rootRef.current.querySelector(
            `[data-ponte-id="${CSS.escape(item.id)}"]`,
          );
          if (el) el.textContent = item.translated;
        }
        applyReplacementsInPlace(rootRef.current, result.replacements);
      }
      setStatus(
        `Done · ${result.sourceLanguage || "?"} → ${result.targetLanguage} · ${result.replacements.length} segments`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Translate failed");
    }
  }, [props]);

  const segments = parseBlocks(preview || props.textBlocks);

  return (
    <div
      ref={rootRef}
      style={{
        fontFamily: "Georgia, 'Times New Roman', serif",
        display: "grid",
        gap: 12,
        padding: 16,
        background:
          "linear-gradient(160deg, #f7f3ea 0%, #e7eef2 55%, #dfe8e1 100%)",
        color: "#1c2a24",
        minWidth: 280,
      }}
    >
      <div style={{ fontSize: 13, letterSpacing: "0.08em", opacity: 0.7 }}>
        PONTE
      </div>
      <button
        type="button"
        onClick={onTranslate}
        style={{
          border: "1px solid #1c2a24",
          background: "#1c2a24",
          color: "#f7f3ea",
          padding: "10px 14px",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        {props.buttonLabel || "Translate in place"}
      </button>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{status}</div>
      <div style={{ display: "grid", gap: 8 }}>
        {segments.map((segment) => (
          <p
            key={segment.id}
            data-ponte-id={segment.id}
            style={{ margin: 0, lineHeight: 1.45, fontSize: 16 }}
          >
            {segment.text}
          </p>
        ))}
      </div>
    </div>
  );
}

addPropertyControls(PonteTranslate, {
  baseUrl: {
    type: ControlType.String,
    title: "Agent URL",
    defaultValue: "http://127.0.0.1:3000",
  },
  targetLanguage: {
    type: ControlType.String,
    title: "Target lang",
    defaultValue: "hi",
  },
  authToken: {
    type: ControlType.String,
    title: "Auth token",
    defaultValue: "",
  },
  pageContext: {
    type: ControlType.String,
    title: "Page context",
    defaultValue: "Framer portfolio",
  },
  textBlocks: {
    type: ControlType.String,
    title: "Text blocks",
    displayTextArea: true,
    defaultValue:
      "hero|The monsoon writes silver letters on the tin roof.\ncta|See selected work",
  },
  buttonLabel: {
    type: ControlType.String,
    title: "Button",
    defaultValue: "Translate in place",
  },
});
