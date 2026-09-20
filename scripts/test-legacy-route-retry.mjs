import { spawnSync } from "node:child_process";
const args = ["--yes", "deno", "run", "--allow-env", "--allow-net", "--allow-read", "--allow-write=test-results", "scripts/test-legacy-route-retry.deno.mjs"];
const result = spawnSync(process.platform === "win32" ? "cmd.exe" : "npx", process.platform === "win32" ? ["/d", "/s", "/c", `npx ${args.join(" ")}`] : args, { env: process.env, stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
