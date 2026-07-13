/**
 * Copies the built engine and bot dists (packages/<name>/dist) into the Supabase Edge
 * Function shared dir so Deno can import them. The bot's bare `@ludo/engine`
 * imports are rewritten to relative paths — Deno has no workspace resolution.
 * Run after building the packages:
 *   npm run build:edge
 */
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shared = join(root, "supabase", "functions", "_shared");

copyPackage("engine");
copyPackage("bot", (source) => source.replaceAll('"@ludo/engine"', '"../engine/index.js"'));

function copyPackage(name, transform) {
  const src = join(root, "packages", name, "dist");
  const dest = join(shared, name);
  if (!existsSync(src)) {
    console.error(`${name} dist not found. Run \`npm run build:packages\` first.`);
    process.exit(1);
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  if (transform) {
    for (const file of readdirSync(dest)) {
      if (!file.endsWith(".js") && !file.endsWith(".d.ts")) continue;
      const path = join(dest, file);
      writeFileSync(path, transform(readFileSync(path, "utf8")));
    }
  }
  console.log(`Copied ${name} -> ${dest}`);
}
