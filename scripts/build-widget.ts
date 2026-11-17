import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [resolve(root, "widget/embed.ts")],
  outfile: resolve(root, "dist/ponte-widget.js"),
  bundle: true,
  format: "iife",
  target: ["es2019"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  charset: "utf8",
});
console.log("Built dist/ponte-widget.js");
