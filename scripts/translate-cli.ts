/**
 * Quick manual check from the terminal:
 *
 *   npm run translate -- hi "The rain came early this year,\nbefore the umbrellas."
 *   echo "Some text" | npm run translate -- ta
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AnthropicModelClient, Ponte } from "../src/core/index.js";
import { loadConfig, withConfig } from "../src/core/config.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(resolve(root, ".env"));
} catch {
  /* no .env */
}

const [lang, ...rest] = process.argv.slice(2);
if (!lang) {
  console.error('Usage: npm run translate -- <lang> "text"   (or pipe text on stdin)');
  process.exit(1);
}
let text = rest.join(" ").replace(/\\n/g, "\n");
if (!text) {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  text = Buffer.concat(chunks).toString("utf8").trim();
}

const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
const out = await new Ponte({ model: new AnthropicModelClient() }).translate(
  withConfig({ targetLanguage: lang, segments: paragraphs.map((p, i) => ({ id: String(i), text: p })) }, loadConfig(root)),
);
if (out.brief) console.error(`[${out.brief.contentType} · ${out.brief.tone}]`);
console.log(out.results.map((r) => r.text).join("\n\n"));
