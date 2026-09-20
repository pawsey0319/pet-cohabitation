import { spawnSync } from "node:child_process";
const args = "npx --yes deno run --allow-env --allow-net --allow-read --env-file=test-results/current-models.private.env supabase/functions/semantic-search/model.test.ts";
const result = spawnSync(process.platform === "win32" ? "cmd.exe" : "sh", process.platform === "win32" ? ["/d", "/s", "/c", args] : ["-c", args], { stdio: "inherit", env: process.env, windowsHide: true });
if (result.error) throw result.error; process.exitCode = result.status ?? 1;
