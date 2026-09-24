import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicValues = {};
for (const filename of [".env", ".env.local"]) {
  const candidate = path.join(root, filename);
  if (!fs.existsSync(candidate)) continue;
  for (const line of fs.readFileSync(candidate, "utf8").split(/\r?\n/)) {
    const match = line.match(/^(EXPO_PUBLIC_SUPABASE_URL|EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)\s*=\s*(.*?)\s*$/);
    if (match) publicValues[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}
if (process.argv.includes("--eas-preview")) {
  const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  const result = spawnSync(process.execPath, [npmCli, "exec", "--yes", "--package", "eas-cli", "--", "eas", "env:list", "preview", "--format", "short"], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120000 });
  if (result.status !== 0) throw new Error("Unable to read the existing EAS preview configuration.");
  // Never print the full EAS environment; copy only the two client-public entries.
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^(EXPO_PUBLIC_SUPABASE_URL|EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)=(.*)$/);
    if (match) publicValues[match[1]] = match[2];
  }
}
for (const key of ["EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) if (process.env[key]) publicValues[key] = process.env[key];
const config = { supabaseUrl: publicValues.EXPO_PUBLIC_SUPABASE_URL, publishableKey: publicValues.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, publicAppUrl: "https://pet-cohabitation-public.vercel.app" };
if (!config.supabaseUrl || !config.publishableKey || !config.supabaseUrl.startsWith("https://")) throw new Error("Missing public Supabase configuration.");
// The allowlist above cannot copy service-role keys, passwords or personal tokens.
fs.writeFileSync(path.join(root, "desktop/config.production.json"), JSON.stringify(config, null, 2) + "\n");
console.log("Desktop public configuration prepared; no credentials displayed.");
