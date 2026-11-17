/**
 * One-off: re-stamp translations saved under settings-v1 (one fingerprint per language)
 * with the per-text settings-v2 fingerprint, computed from the settings they were actually
 * made with. Without this, every v1 entry would look outdated and be re-translated for nothing.
 *
 *   npx tsx scripts/migrate-settings.ts <translations dir>
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { settingsKey } from "../src/core/agent.js";
import { withConfig, type PonteConfig } from "../src/core/config.js";
import { serialize, type LanguageFile } from "../src/core/store.js";

const dir = process.argv[2] ?? "translations";
// Settings in force when the v1 entries were made (17 Nov 2026): author rules + Hindi name only.
const v1: PonteConfig = {
  sourceLanguage: "en",
  author: {
    name: "Lalitya Krishnan",
    gender: "male",
    notes: "Senior product designer from Mumbai, India. Writes about his own work and life in the first person.",
  },
  doNotTranslate: [],
  glossary: { hi: { "Lalitya Krishnan": "लालित्य कृष्णन", Lalitya: "लालित्य", Krishnan: "कृष्णन" } },
};

for (const f of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
  const lang = f.replace(/\.json$/, "");
  const data = JSON.parse(await readFile(join(dir, f), "utf8")) as LanguageFile;
  const req = withConfig({ targetLanguage: lang, segments: [] }, v1);
  let restamped = 0;
  let unstamped = 0;
  for (const e of Object.values(data)) {
    if (!e.settings) unstamped++; // made before name/gender rules: stays outdated on purpose
    else {
      e.settings = settingsKey(req, lang, e.source);
      restamped++;
    }
  }
  await writeFile(join(dir, f), serialize(data));
  console.log(`${lang}: ${restamped} re-stamped, ${unstamped} from before the name/gender rules`);
}
