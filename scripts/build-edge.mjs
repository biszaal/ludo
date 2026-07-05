/**
 * Copies the built engine (packages/engine/dist) into the Supabase Edge Function
 * shared dir so Deno can import it. Run after building the engine:
 *   npm run build:edge
 */
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "packages", "engine", "dist");
const dest = join(root, "supabase", "functions", "_shared", "engine");

if (!existsSync(src)) {
  console.error("Engine dist not found. Run `npm run build:engine` first.");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied engine -> ${dest}`);
