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
  for (const file of readdirSync(dest)) {
    const isJs = file.endsWith(".js");
    const isDts = file.endsWith(".d.ts");
    if (!isJs && !isDts) continue;
    const path = join(dest, file);
    let source = readFileSync(path, "utf8");
    if (transform) source = transform(source);
    // tsc emits declarations that import their siblings as "./x.js" — correct
    // for tsc, which maps a .js specifier to the .d.ts beside it, but Deno
    // takes it literally, finds an untyped .js, and every type in the graph
    // silently collapses to `any`. That is why `deno check` on the edge
    // function used to report a wall of implicit-any errors. Point the
    // declarations at each other directly.
    if (isDts) source = source.replaceAll(/(from\s+"\.[^"]*)\.js"/g, '$1.d.ts"');
    writeFileSync(path, source);
  }
  console.log(`Copied ${name} -> ${dest}`);
}
