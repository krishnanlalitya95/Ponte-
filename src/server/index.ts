import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AnthropicModelClient, Ponte } from "../core/index.js";
import { MockModelClient } from "../core/mock.js";
import { configFromEnv, createHandler } from "./app.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
try {
  process.loadEnvFile(resolve(root, ".env"));
} catch {
  // no .env file — rely on the real environment
}

const port = Number(process.env.PORT ?? 8787);
const mock = process.env.PONTE_MOCK === "1";
const ponte = new Ponte({ model: mock ? new MockModelClient() : new AnthropicModelClient() });
const config = configFromEnv(root);

createServer(createHandler(ponte, config)).listen(port, () => {
  console.log(`Ponte listening on http://localhost:${port}`);
  console.log(`  demo:      http://localhost:${port}/demo`);
  console.log(`  widget:    http://localhost:${port}/widget.js`);
  console.log(`  translate: POST http://localhost:${port}/v1/channels/framer/translate`);
  console.log(`  model:     ${mock ? "MOCK (pseudo-translations, no API calls)" : process.env.PONTE_MODEL || "claude-sonnet-5-5"}`);
});
