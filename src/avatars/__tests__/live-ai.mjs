// Run with scripts/with-companion-env.ps1. Does not alter either Edge fixture.
import { spawnSync } from "node:child_process";
const args = ["--yes", "deno", "run", "--allow-env", "--allow-net", "--allow-read", "--allow-write=test-results", "src/avatars/__tests__/live-ai.deno.mjs"];
const child = spawnSync(process.platform === "win32" ? "cmd.exe" : "npx", process.platform === "win32" ? ["/d", "/s", "/c", `npx ${args.join(" ")}`] : args, { env: process.env, stdio: "inherit", windowsHide: true });
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
