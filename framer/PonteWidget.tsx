/**
 * Ponte — visitor widget (Framer code component).
 *
 * Drop it anywhere on a page (nav bar, footer, floating). Visitors pick a language
 * and every plain-text layer on the page is rewritten in place by Ponte.
 *
 * In Framer: Assets → Code → New Component → paste this file.
 * Set "Endpoint" to your Ponte server (http://localhost:8787 while developing).
 *
 * On the editor canvas it only shows the picker; translation runs in Preview and on
 * the published site so it never touches the editor's own UI.
 */
import { useEffect, useRef, useState } from "react"
import { addPropertyControls, ControlType, RenderTarget } from "framer"

type Status = { state: string; language: string | null; failed?: number; error?: string }

declare global {
    interface Window {
        Ponte?: any
    }
}

const LANGS: Record<string, string> = {
    hi: "हिन्दी", bn: "বাংলা", ta: "தமிழ்", te: "తెలుగు", mr: "मराठी", gu: "ગુજરાતી",
    kn: "ಕನ್ನಡ", ml: "മലയാളം", pa: "ਪੰਜਾਬੀ", or: "ଓଡ଼ିଆ", ur: "اردو",
    en: "English", es: "Español", fr: "Français", de: "Deutsch", pt: "Português", it: "Italiano",
    ja: "日本語", zh: "简体中文", ko: "한국어", ar: "العربية", ru: "Русский", id: "Bahasa Indonesia",
    tr: "Türkçe", nl: "Nederlands",
}

function loadEngine(endpoint: string): Promise<any> {
    if (window.Ponte?.createPonte) return Promise.resolve(window.Ponte)
    const src = `${endpoint.replace(/\/+$/, "")}/widget.js`
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null
        const s = existing ?? document.createElement("script")
        s.addEventListener("load", () => resolve(window.Ponte))
        s.addEventListener("error", () => reject(new Error(`Couldn't load ${src}`)))
        if (!existing) {
            s.src = src
            s.async = true
            document.head.appendChild(s)
        }
    })
}

/**
 * @framerSupportedLayoutWidth auto
 * @framerSupportedLayoutHeight auto
 */
export default function PonteWidget(props) {
    const {
        endpoint, languages, sourceLanguage, contentType, doNotTranslate, notes,
        originalLabel, font, color, background, radius, padding, showStatus,
    } = props
    const onCanvas = RenderTarget.current() === RenderTarget.canvas
    const ctrl = useRef<any>(null)
    const [value, setValue] = useState("")
    const [status, setStatus] = useState<Status | null>(null)

    useEffect(() => {
        if (onCanvas || typeof window === "undefined") return
        let cancelled = false
        loadEngine(endpoint)
            .then((P) => {
                if (cancelled) return
                ctrl.current = P.createPonte({
                    endpoint,
                    sourceLanguage: sourceLanguage || undefined,
                    contentType: contentType === "auto" ? undefined : contentType,
                    doNotTranslate: doNotTranslate
                        ? doNotTranslate.split(",").map((s: string) => s.trim()).filter(Boolean)
                        : undefined,
                    notes: notes || undefined,
                    onStatus: (s: Status) => {
                        setStatus(s)
                        setValue(s.language ?? "")
                    },
                })
                P.instance = ctrl.current
                const pref = P.preferredLanguage()
                if (pref && pref !== sourceLanguage) ctrl.current.translate(pref)
            })
            .catch((e) => setStatus({ state: "error", language: null, error: String(e) }))
        return () => {
            cancelled = true
            ctrl.current?.destroy()
            ctrl.current = null
        }
    }, [endpoint, sourceLanguage, contentType, doNotTranslate, notes, onCanvas])

    const onChange = (e) => {
        const lang = e.target.value
        setValue(lang)
        if (!ctrl.current) return
        if (lang) ctrl.current.translate(lang)
        else ctrl.current.restore()
    }

    const codes: string[] = (languages || "").split(",").map((s: string) => s.trim()).filter((c: string) => LANGS[c] && c !== sourceLanguage)
    const statusText =
        status?.state === "translating" ? "Translating…"
        : status?.state === "error" ? "Couldn't translate"
        : status?.failed ? `${status.failed} left as is`
        : ""

    return (
        <div
            data-ponte-skip=""
            style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding, borderRadius: radius, background, color, ...font,
            }}
        >
            <span aria-hidden="true">文A</span>
            <select
                aria-label="Translate this page"
                value={value}
                onChange={onChange}
                style={{
                    appearance: "none", background: "transparent", border: 0, color: "inherit",
                    font: "inherit", cursor: "pointer",
                }}
            >
                <option value="" style={{ color: "#111" }}>{originalLabel}</option>
                {codes.map((c) => (
                    <option key={c} value={c} style={{ color: "#111" }}>{LANGS[c]}</option>
                ))}
            </select>
            {showStatus && statusText ? (
                <span aria-live="polite" style={{ opacity: 0.7, fontSize: "0.85em" }}>{statusText}</span>
            ) : null}
        </div>
    )
}

PonteWidget.defaultProps = {
    endpoint: "http://localhost:8787",
    languages: "hi,bn,ta,te,mr,gu,kn,ml,pa,en,es,fr,de,pt,ja,zh,ko,ar",
    sourceLanguage: "en",
    contentType: "auto",
    doNotTranslate: "",
    notes: "",
    originalLabel: "Original",
    color: "#FFFFFF",
    background: "rgba(20,20,20,0.88)",
    radius: 999,
    padding: "8px 14px",
    showStatus: true,
}

addPropertyControls(PonteWidget, {
    endpoint: { type: ControlType.String, title: "Endpoint" },
    languages: {
        type: ControlType.String,
        title: "Languages",
        description: "Comma-separated codes: hi, bn, ta, te, mr, gu, kn, ml, pa, or, ur, en, es, fr, de, pt, it, ja, zh, ko, ar, ru, id, tr, nl",
    },
    sourceLanguage: { type: ControlType.String, title: "Page language" },
    contentType: {
        type: ControlType.Enum,
        title: "Content",
        options: ["auto", "poetry", "narrative", "case_study", "paper", "portfolio_copy", "ui_copy", "mixed"],
        optionTitles: ["Detect", "Poetry", "Story", "Case study", "Paper", "Portfolio copy", "UI copy", "Mixed"],
    },
    doNotTranslate: { type: ControlType.String, title: "Keep as is", placeholder: "Ponte, ICICI Lombard" },
    notes: { type: ControlType.String, title: "Notes", displayTextArea: true, placeholder: "Context for the translator" },
    originalLabel: { type: ControlType.String, title: "Original label" },
    font: { type: ControlType.Font, controls: "extended", defaultFontType: "sans-serif", defaultValue: { fontSize: 13 } },
    color: { type: ControlType.Color, title: "Text" },
    background: { type: ControlType.Color, title: "Fill" },
    radius: { type: ControlType.Number, title: "Radius", min: 0, max: 999 },
    padding: { type: ControlType.Padding, title: "Padding" },
    showStatus: { type: ControlType.Boolean, title: "Status" },
})
