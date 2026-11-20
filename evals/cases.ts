import type { ContentType, Segment, Voice } from "../src/core/types.js";

export interface EvalCase {
  name: string;
  targetLanguage: string;
  expectedType: ContentType | ContentType[];
  segments: Segment[];
  context?: { title?: string; notes?: string };
  doNotTranslate?: string[];
  /** Exact strings that must survive (numbers, kept names). */
  mustContain?: string[];
  /** Keep the line count of verse. */
  keepLines?: boolean;
  /** Voice to translate in (see Voice). */
  voice?: Voice;
  /** Textbook/official words that should NOT appear in an everyday translation. */
  mustAvoid?: string[];
  /** What a good translation must carry over — given to the judge. */
  meaningNotes: string;
}

export const CASES: EvalCase[] = [
  {
    name: "poetry · en → hi",
    targetLanguage: "hi",
    expectedType: "poetry",
    context: { title: "Monsoon letters" },
    segments: [
      { id: "title", text: "Monsoon letters", role: "h2" },
      {
        id: "poem",
        role: "p",
        text:
          "The rain came early this year,\nbefore the umbrellas,\nbefore we learned to stop\nwaiting at the window.\nMother says the city forgets\nevery June — and every June\nit remembers us anyway.",
      },
    ],
    keepLines: true,
    meaningNotes:
      "Nostalgic, tender. 'Before the umbrellas' = before anyone was ready. Waiting at the window implies longing for someone/something. Final turn: the city forgets each year yet still embraces them — keep that reversal and its warmth. Must read as a poem in Hindi, not prose.",
  },
  {
    name: "poetry · hi → en",
    targetLanguage: "en",
    expectedType: "poetry",
    segments: [
      {
        id: "poem",
        role: "p",
        text: "शाम की चाय में\nमाँ ने आज फिर\nथोड़ी ज़्यादा इलायची डाल दी —\nजैसे कह रही हो,\nरुक जाओ, अभी मत जाओ।",
      },
    ],
    keepLines: true,
    meaningNotes:
      "Mother adds extra cardamom to the evening tea — an unspoken plea to stay a little longer. The implicature (care expressed through tea, not words) must survive; 'आज फिर' signals this has happened before. Ending is a gentle plea, not a command.",
  },
  {
    name: "narrative · en → ta",
    targetLanguage: "ta",
    expectedType: "narrative",
    segments: [
      {
        id: "p1",
        role: "p",
        text:
          "My grandfather kept his watch ten minutes fast, so he'd never be late for anything that mattered. He was late for his own retirement party anyway, because he stopped to help a stranger change a tyre.",
      },
      { id: "p2", role: "p", text: "Everyone said he had a heart of gold. He said he just hated waiting." },
    ],
    meaningNotes:
      "Gentle irony: the man obsessed with punctuality is late because of kindness. 'Heart of gold' is an idiom — should become a natural Tamil expression of goodness, not a literal golden heart. His dry, self-deprecating reply must stay understated and funny.",
  },
  {
    name: "case study · en → es",
    targetLanguage: "es",
    expectedType: "case_study",
    doNotTranslate: ["CareOne"],
    segments: [
      { id: "h", role: "h2", text: "CareOne: rebuilding motor claims around the first ten minutes" },
      {
        id: "p",
        role: "p",
        text:
          "After an accident, customers had to call a helpline, wait on hold, and repeat the same details three times. We moved the first notice of loss into a guided, photo-first flow that works on a cracked phone screen in bad light.",
      },
      { id: "m", role: "figcaption", text: "38% fewer drop-offs in the first notice of loss, measured over eight weeks." },
    ],
    mustContain: ["CareOne", "38"],
    meaningNotes:
      "Professional design case study. 'First notice of loss' is insurance jargon (FNOL) — use the established Spanish insurance term or a clear equivalent. Keep '38%' and 'eight weeks' exact. 'Photo-first' and 'cracked phone screen in bad light' convey real-world empathy; keep that.",
  },
  {
    name: "paper · en → bn",
    targetLanguage: "bn",
    expectedType: "paper",
    segments: [
      { id: "h", role: "h2", text: "Designing for low-literacy insurance customers in tier-3 cities" },
      {
        id: "abs",
        role: "p",
        text:
          "We report a mixed-methods study (n = 42) of how first-time policyholders interpret claim-status messages. Participants consistently over-trusted progress bars and under-read text, which suggests that status UI may create false certainty.",
      },
    ],
    mustContain: ["42"],
    meaningNotes:
      "Academic abstract. Hedging must survive: 'suggests' and 'may' are deliberate — the translation must not turn them into certainty. 'Mixed-methods', 'n = 42', 'over-trusted', 'under-read' must be precise. 'Tier-3 cities' is an Indian classification; keep the sense.",
  },
  {
    name: "ui copy · en → ja",
    targetLanguage: "ja",
    expectedType: ["ui_copy", "portfolio_copy", "mixed"],
    segments: [
      { id: "1", role: "a in nav", text: "Work" },
      { id: "2", role: "a in nav", text: "About" },
      { id: "3", role: "button", text: "See selected work" },
      { id: "4", role: "button", text: "Get in touch" },
    ],
    meaningNotes:
      "Short navigation and button labels on a personal portfolio. Natural, concise Japanese UI conventions (e.g. 'Work' as a portfolio section, not 'labour'). Polite but not stiff.",
  },
  {
    name: "portfolio copy · en → fr",
    targetLanguage: "fr",
    expectedType: ["portfolio_copy", "mixed"],
    doNotTranslate: ["ICICI Lombard"],
    segments: [
      { id: "h1", role: "h1", text: "I design calm software for anxious moments." },
      {
        id: "p",
        role: "p",
        text:
          "Most of my work lives where people are already having a bad day — a car accident, a hospital bill, a claim that's gone quiet. I try to make the next step obvious and the wait feel shorter. Currently at ICICI Lombard.",
      },
    ],
    mustContain: ["ICICI Lombard"],
    meaningNotes:
      "Confident first-person designer voice. The headline's contrast (calm vs anxious) must land as a crisp tagline. 'A claim that's gone quiet' = a claim with no updates; render the feeling, not literally a silent claim. Consistent register (je, no stiff vous-to-reader).",
  },
{
    name: "everyday voice · portfolio en → hi",
    targetLanguage: "hi",
    expectedType: ["portfolio_copy", "case_study", "mixed"],
    voice: "everyday",
    segments: [
      { id: "h1", role: "h1", text: "I design apps that help people when things go wrong." },
      {
        id: "p",
        role: "p",
        text:
          "For this project I talked to twenty users, tested three prototypes with the team, and used their feedback to make filing a claim simple enough to finish in five minutes.",
      },
    ],
    mustContain: ["5"],
    mustAvoid: ["प्रयोक्ता", "अनुप्रयोग", "अभिकल्पना", "आवश्यक", "प्रारंभ", "सहायता", "उपयोगकर्ताओं"],
    meaningNotes:
      "Must sound like everyday Hindi a young professional in Mumbai would actually say — Hindustani, with the English words people really use (डिज़ाइन, ऐप, यूज़र, प्रोजेक्ट, टीम, फ़ीडबैक, प्रोटोटाइप). Penalise heavily any शुद्ध/सरकारी Hindi or Sanskritised coinages even if accurate. Numbers (twenty, three, five minutes) must stay exact.",
  },
  {
    name: "everyday voice · portfolio en → ta",
    targetLanguage: "ta",
    expectedType: ["portfolio_copy", "case_study", "mixed"],
    voice: "everyday",
    segments: [
      {
        id: "p",
        role: "p",
        text: "I spent two weeks with the claims team to understand why users kept calling support. The answer was simple: the app never told them what happens next.",
      },
    ],
    meaningNotes:
      "Simple modern written Tamil with everyday vocabulary and the English loanwords Tamil speakers really use (டீம், யூசர், ஆப், சப்போர்ட்). Penalise literary செந்தமிழ் or தனித்தமிழ் coinages for tech words, and penalise spoken-dialect spellings. The 'simple answer' turn must land.",
  },
];
