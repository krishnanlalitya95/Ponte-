/**
 * Smoke evals: does Ponte keep meaning, tone and form across genres and languages?
 *
 *   npm run eval                 # all cases
 *   npm run eval -- poetry       # cases whose name contains "poetry"
 *
 * Each case is translated by Ponte, checked deterministically (kept terms, numbers,
 * line counts, detected genre), then graded by a separate Claude call acting as a
 * bilingual reviewer who did not do the translation. Writes evals/reports/<time>.md.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AnthropicModelClient, Ponte, getLanguage } from "../src/core/index.js";
import { CASES, type EvalCase } from "./cases.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(resolve(root, ".env"));
} catch {
  /* no .env */
}

interface Grade {
  meaning: number;
  tone: number;
  fluency: number;
  wordForWord: boolean;
  issues: string[];
  verdict: string;
}

const PASS = { meaning: 4, tone: 4, fluency: 4 };
const filter = process.argv[2]?.trim().toLowerCase() || undefined;
const cases = CASES.filter((c) => !filter || c.name.toLowerCase().includes(filter));

const translatorModel = new AnthropicModelClient();
const judge = new AnthropicModelClient(process.env.PONTE_JUDGE_MODEL || "claude-opus-5-5");
const ponte = new Ponte({ model: translatorModel });

const lines: string[] = [`# Ponte eval — ${new Date().toISOString()}`, "", `Translator: ${translatorModel.model} · Judge: ${judge.model}`, ""];
let passed = 0;

for (const c of cases) {
  process.stdout.write(`• ${c.name} … `);
  const out = await ponte.translate({
    targetLanguage: c.targetLanguage,
    segments: c.segments,
    context: c.context,
    doNotTranslate: c.doNotTranslate,
  });
  const source = c.segments.map((s) => s.text).join("\n\n");
  const translation = out.results.map((r) => r.text).join("\n\n");

  const failures = deterministicChecks(c, out.brief.contentType, out.results.map((r) => r.text), out.results.map((r) => r.status));
  const grade = await gradeIt(c, source, translation);
  const ok =
    failures.length === 0 && grade.meaning >= PASS.meaning && grade.tone >= PASS.tone && grade.fluency >= PASS.fluency && !grade.wordForWord;
  if (ok) passed++;
  console.log(ok ? "PASS" : "FAIL", `(meaning ${grade.meaning}, tone ${grade.tone}, fluency ${grade.fluency})`);

  lines.push(
    `## ${ok ? "✅" : "❌"} ${c.name}`,
    "",
    `Detected: **${out.brief.contentType}** · tone: ${out.brief.tone}`,
    `Scores — meaning **${grade.meaning}**/5 · tone **${grade.tone}**/5 · fluency **${grade.fluency}**/5 · word-for-word: ${grade.wordForWord ? "yes" : "no"}`,
    "",
    failures.length ? `Check failures: ${failures.join("; ")}\n` : "",
    `Judge: ${grade.verdict}`,
    grade.issues.length ? `\nIssues:\n${grade.issues.map((i) => `- ${i}`).join("\n")}` : "",
    "",
    "<details><summary>Source / translation</summary>",
    "",
    "```",
    source,
    "```",
    "",
    "```",
    translation,
    "```",
    "</details>",
    "",
  );
}

lines.splice(3, 0, `**${passed}/${cases.length} passed**`, "");
const dir = resolve(root, "evals/reports");
await mkdir(dir, { recursive: true });
const file = resolve(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
await writeFile(file, lines.join("\n"));
console.log(`\n${passed}/${cases.length} passed · report: ${file}`);
process.exit(passed === cases.length ? 0 : 1);

function deterministicChecks(c: EvalCase, type: string, texts: string[], statuses: string[]): string[] {
  const f: string[] = [];
  const all = texts.join("\n");
  const expected = Array.isArray(c.expectedType) ? c.expectedType : [c.expectedType];
  if (!expected.includes(type as never)) f.push(`content type ${type}, expected ${expected.join("/")}`);
  if (statuses.includes("fallback")) f.push("some segments fell back to the original");
  for (const m of c.mustContain ?? []) if (!all.includes(m)) f.push(`missing "${m}"`);
  if (c.keepLines) {
    c.segments.forEach((s, i) => {
      const want = s.text.split("\n").length;
      const got = (texts[i] ?? "").split("\n").length;
      if (want > 1 && Math.abs(want - got) > 1) f.push(`line count ${got} vs ${want} in ${s.id}`);
    });
  }
  return f;
}

async function gradeIt(c: EvalCase, source: string, translation: string): Promise<Grade> {
  const target = getLanguage(c.targetLanguage)!;
  const res = await judge.structured<Grade>({
    system:
      "You are a demanding bilingual literary and technical reviewer. You did not write this translation. " +
      "Judge whether a native reader of the target language would get the same meaning, intent and feeling as a reader of the source. " +
      "Penalise literal, word-for-word renderings that are grammatical but unnatural, dropped nuance (hedging, irony, implicature), " +
      "changed facts or numbers, and register drift. Be specific and strict: 5 = publishable by a professional translator.",
    user: [
      `Target language: ${target.name}`,
      `What a good translation must carry over: ${c.meaningNotes}`,
      "",
      "<source>",
      source,
      "</source>",
      "",
      "<translation>",
      translation,
      "</translation>",
    ].join("\n"),
    toolName: "grade",
    toolDescription: "Record your grades.",
    schema: {
      type: "object",
      properties: {
        meaning: { type: "integer", minimum: 1, maximum: 5, description: "Meaning and intent preserved." },
        tone: { type: "integer", minimum: 1, maximum: 5, description: "Tone, register and feel preserved." },
        fluency: { type: "integer", minimum: 1, maximum: 5, description: "Reads as natural native writing." },
        wordForWord: { type: "boolean", description: "True if it reads like a word-for-word machine rendering." },
        issues: { type: "array", items: { type: "string" } },
        verdict: { type: "string", description: "One or two sentences." },
      },
      required: ["meaning", "tone", "fluency", "wordForWord", "issues", "verdict"],
    },
    maxTokens: 1500,
  });
  return res.data;
}
