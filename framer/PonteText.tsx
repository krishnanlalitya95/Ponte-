/**
 * Ponte — text component (Framer code component, author workflow).
 *
 * Use it in place of a text layer for long-form work (poems, stories, case-study
 * sections, papers). Paste the original into "Text", pick a target language, and
 * the translated text renders right on the canvas so you can review and style it
 * while editing (needs a running Ponte server). Set "Language" to "Follow widget" to
 * show the original and let the Ponte widget translate it with the rest of the page —
 * this works in Static mode too, because pre-translate picks it up like any other text.
 *
 * In Framer: Assets → Code → New Component → paste this file.
 */
import { useEffect, useState } from "react"
import { addPropertyControls, ControlType } from "framer"

const OPTIONS = ["follow", "original", "hi", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa", "or", "ur",
    "en", "es", "fr", "de", "pt", "it", "ja", "zh", "ko", "ar", "ru", "id", "tr", "nl"]
const TITLES = ["Follow widget", "Original", "Hindi", "Bengali", "Tamil", "Telugu", "Marathi", "Gujarati",
    "Kannada", "Malayalam", "Punjabi", "Odia", "Urdu", "English", "Spanish", "French", "German", "Portuguese",
    "Italian", "Japanese", "Chinese", "Korean", "Arabic", "Russian", "Indonesian", "Turkish", "Dutch"]
const RTL = new Set(["ar", "ur"])

// Shared across instances so the same text isn't fetched twice in a session.
const memo = new Map<string, Promise<string>>()

function translate(endpoint: string, text: string, lang: string, contentType: string, notes: string, title: string) {
    const key = [endpoint, lang, contentType, notes, text].join("\u0000")
    let p = memo.get(key)
    if (!p) {
        p = fetch(`${endpoint.replace(/\/+$/, "")}/v1/channels/framer/translate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                targetLanguage: lang,
                contentType: contentType === "auto" ? undefined : contentType,
                context: { title: title || undefined, notes: notes || undefined },
                segments: [{ id: "text", text, role: "p" }],
            }),
        }).then(async (r) => {
            const data = await r.json()
            if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
            const res = data.results?.[0]
            if (!res || res.status === "fallback") throw new Error(res?.reason || "Translation failed")
            return res.text as string
        })
        p.catch(() => memo.delete(key))
        memo.set(key, p)
    }
    return p
}

/**
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight auto
 */
export default function PonteText(props) {
    const { text, language, endpoint, contentType, notes, title, font, color, align, showErrors } = props
    const follow = language === "follow"
    const [out, setOut] = useState<string>(text)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    // "Follow widget": render the original as normal page text; the widget translates it.
    const target = follow || language === "original" ? null : language

    useEffect(() => {
        if (!target || !text?.trim()) {
            setOut(text)
            setError(null)
            return
        }
        let live = true
        setLoading(true)
        translate(endpoint, text, target, contentType, notes, title)
            .then((t) => live && (setOut(t), setError(null)))
            .catch((e) => live && (setOut(text), setError(String(e.message || e))))
            .finally(() => live && setLoading(false))
        return () => {
            live = false
        }
    }, [text, target, endpoint, contentType, notes, title])

    return (
        <div
            data-ponte-skip={follow ? undefined : ""}
            lang={target || undefined}
            dir={target && RTL.has(target) ? "rtl" : undefined}
            style={{
                ...font,
                color,
                textAlign: align,
                whiteSpace: "pre-wrap",
                opacity: loading ? 0.55 : 1,
                transition: "opacity 200ms ease",
            }}
        >
            {out}
            {showErrors && error ? (
                <div style={{ marginTop: 8, fontSize: 12, color: "#c0392b", fontFamily: "system-ui" }}>
                    Ponte: {error}
                </div>
            ) : null}
        </div>
    )
}

PonteText.defaultProps = {
    text: "Write or paste the original text here.",
    language: "hi",
    endpoint: "http://localhost:8787",
    contentType: "auto",
    notes: "",
    title: "",
    color: "#111111",
    align: "left",
    showErrors: true,
}

addPropertyControls(PonteText, {
    text: { type: ControlType.String, title: "Text", displayTextArea: true },
    language: { type: ControlType.Enum, title: "Language", options: OPTIONS, optionTitles: TITLES },
    contentType: {
        type: ControlType.Enum,
        title: "Content",
        options: ["auto", "poetry", "narrative", "case_study", "paper", "portfolio_copy", "ui_copy"],
        optionTitles: ["Detect", "Poetry", "Story", "Case study", "Paper", "Portfolio copy", "UI copy"],
    },
    title: { type: ControlType.String, title: "Work title", placeholder: "e.g. Monsoon Letters" },
    notes: { type: ControlType.String, title: "Notes", displayTextArea: true, placeholder: "Context for the translator" },
    endpoint: { type: ControlType.String, title: "Endpoint" },
    font: { type: ControlType.Font, controls: "extended", defaultFontType: "sans-serif", defaultValue: { fontSize: 18, lineHeight: 1.5 } },
    color: { type: ControlType.Color, title: "Color" },
    align: { type: ControlType.Enum, title: "Align", options: ["left", "center", "right"], displaySegmentedControl: true },
    showErrors: { type: ControlType.Boolean, title: "Show errors" },
})
