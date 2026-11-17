/**
 * Ponte — visitor widget (Framer code component).
 *
 * Drop it anywhere on a page (nav bar, footer, floating). Visitors pick a language
 * and every plain-text layer on the page is rewritten in place by Ponte.
 *
 * In Framer: Assets → Code → New Component → paste this file.
 *
 * Mode "Static" (default, free): reads translations published to GitHub Pages by the
 * "Publish translations" workflow. No server; unpublished text stays in the original.
 * Mode "Server": asks a running Ponte server, which translates new text live.
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

function loadEngine(base: string): Promise<any> {
    if (window.Ponte?.createPonte) return Promise.resolve(window.Ponte)
    const src = `${base.replace(/\/+$/, "")}/widget.js`
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null
        const s = existing ?? document.createElement("script")
        s.addEventListener("load", () => resolve(window.Ponte))
        s.addEventListener("error", () => reject(new Error(`Couldn't load ${src}`)))
        if (!existing) {
            s.setAttribute("data-manual", "") // this component drives it; no auto picker
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
        mode, staticUrl, endpoint, fonts, languages, sourceLanguage, contentType, doNotTranslate, notes,
        originalLabel, autoDetect, font, color, background, radius, padding, showStatus,
    } = props
    const onCanvas = RenderTarget.current() === RenderTarget.canvas
    const ctrl = useRef<any>(null)
    const [value, setValue] = useState("")
    const [status, setStatus] = useState<Status | null>(null)

    useEffect(() => {
        if (onCanvas || typeof window === "undefined") return
        let cancelled = false
        const isStatic = mode !== "server"
        loadEngine(isStatic ? staticUrl : endpoint)
            .then((P) => {
                if (cancelled) return
                ctrl.current = P.createPonte({
                    staticBase: isStatic ? staticUrl : undefined,
                    endpoint: isStatic ? undefined : endpoint,
                    fonts,
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
                // The visitor's last choice, else their device language if it's offered here.
                const offered = (languages || "").split(",").map((s: string) => s.trim()).filter(Boolean)
                const available = isStatic ? P.publishedLanguages(staticUrl) : Promise.resolve(offered)
                available.then((pub: string[]) => {
                    if (cancelled || !ctrl.current) return
                    const usable = isStatic ? offered.filter((c: string) => pub.includes(c)) : offered
                    const first = P.initialLanguage({ available: usable, source: sourceLanguage || "en", auto: autoDetect })
                    if (first) ctrl.current.translate(first)
                })
            })
            .catch((e) => setStatus({ state: "error", language: null, error: String(e) }))
        return () => {
            cancelled = true
            ctrl.current?.destroy()
            ctrl.current = null
        }
    }, [mode, staticUrl, endpoint, fonts, languages, sourceLanguage, autoDetect, contentType, doNotTranslate, notes, onCanvas])

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
                <option value="" style={{ color: "#111" }}>{originalLabel || LANGS[sourceLanguage] || "Original"}</option>
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
    mode: "static",
    staticUrl: "https://krishnanlalitya95.github.io/Ponte-",
    endpoint: "http://localhost:8787",
    fonts: true,
    languages: "hi,bn,ta,te,mr,gu,kn,ml,pa,en,es,fr,de,pt,ja,zh,ko,ar",
    sourceLanguage: "en",
    contentType: "auto",
    doNotTranslate: "",
    notes: "",
    originalLabel: "",
    autoDetect: true,
    color: "#FFFFFF",
    background: "rgba(20,20,20,0.88)",
    radius: 999,
    padding: "8px 14px",
    showStatus: true,
}

addPropertyControls(PonteWidget, {
    mode: {
        type: ControlType.Enum,
        title: "Mode",
        options: ["static", "server"],
        optionTitles: ["Static (free)", "Server"],
        displaySegmentedControl: true,
    },
    staticUrl: { type: ControlType.String, title: "Published at", hidden: (p) => p.mode === "server" },
    endpoint: { type: ControlType.String, title: "Endpoint", hidden: (p) => p.mode !== "server" },
    fonts: { type: ControlType.Boolean, title: "Script fonts", enabledTitle: "Noto", disabledTitle: "Off" },
    languages: {
        type: ControlType.String,
        title: "Languages",
        description: "Comma-separated codes: hi, bn, ta, te, mr, gu, kn, ml, pa, or, ur, en, es, fr, de, pt, it, ja, zh, ko, ar, ru, id, tr, nl",
    },
    sourceLanguage: { type: ControlType.String, title: "Page language" },
    contentType: {
        type: ControlType.Enum,
        title: "Content",
        hidden: (p) => p.mode !== "server",
        options: ["auto", "poetry", "narrative", "case_study", "paper", "portfolio_copy", "ui_copy", "mixed"],
        optionTitles: ["Detect", "Poetry", "Story", "Case study", "Paper", "Portfolio copy", "UI copy", "Mixed"],
    },
    doNotTranslate: { type: ControlType.String, title: "Keep as is", placeholder: "Ponte, ICICI Lombard", hidden: (p) => p.mode !== "server" },
    notes: { type: ControlType.String, title: "Notes", displayTextArea: true, placeholder: "Context for the translator", hidden: (p) => p.mode !== "server" },
    originalLabel: { type: ControlType.String, title: "Original label", placeholder: "Page language name" },
    autoDetect: {
        type: ControlType.Boolean,
        title: "Visitor language",
        enabledTitle: "Auto",
        disabledTitle: "Off",
        description: "Open in the visitor's device language when it's offered.",
    },
    font: { type: ControlType.Font, controls: "extended", defaultFontType: "sans-serif", defaultValue: { fontSize: 13 } },
    color: { type: ControlType.Color, title: "Text" },
    background: { type: ControlType.Color, title: "Fill" },
    radius: { type: ControlType.Number, title: "Radius", min: 0, max: 999 },
    padding: { type: ControlType.Padding, title: "Padding" },
    showStatus: { type: ControlType.Boolean, title: "Status" },
})
