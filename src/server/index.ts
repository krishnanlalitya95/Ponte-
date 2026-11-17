import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AnthropicModelClient, Ponte } from "../core/index.js";
import { MockModelClient } from "../core/mock.js";
import { storeFromEnv } from "../core/store.js";
import { loadConfig } from "../core/config.js";
import { configFromEnv, createHandler } from "./app.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
try {
  process.loadEnvFile(resolve(root, ".env"));
} catch {
  // no .env file — rely on the real environment
}

const port = Number(process.env.PORT ?? 8787);
const mock = process.env.PONTE_MOCK === "1";
// Mock translations are never saved to your real translation files.
const store = storeFromEnv(root, mock ? { ...process.env, PONTE_STORE: "memory" } : process.env);
const ponte = new Ponte({ model: mock ? new MockModelClient() : new AnthropicModelClient(), store });
const config = configFromEnv(root);

const server = createServer(createHandler(ponte, config, loadConfig(root))).listen(port, () => {
  console.log(`Ponte listening on http://localhost:${port}`);
  console.log(`  demo:      http://localhost:${port}/demo`);
  console.log(`  widget:    http://localhost:${port}/widget.js`);
  console.log(`  translate: POST http://localhost:${port}/v1/channels/framer/translate`);
  console.log(`  saved to:  ${"backend" in store ? (store as { backend: { name: string } }).backend.name : "memory (not saved)"}`);
  console.log(`  model:     ${mock ? "MOCK (pseudo-translations, no API calls)" : process.env.PONTE_MODEL || "claude-sonnet-5-5"}`);
});

// Write any translations still waiting to be saved before the process exits.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    server.close();
    try {
      await store.flush();
    } catch (e) {
      console.error("[ponte] couldn't save pending translations:", e);
    }
    process.exit(0);
  });
}
