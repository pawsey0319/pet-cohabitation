import { spawnSync } from "node:child_process";
const deno = process.env.DENO_BIN ?? "C:/Users/97284/AppData/Local/npm-cache/_npx/05b6ef7b13673c57/node_modules/deno/deno.exe";
const result = spawnSync(deno, ["run", "--allow-env", "--allow-net=127.0.0.1:47321", "--allow-read", "--allow-write=test-results/mobile-feedback-20260914", "supabase/functions/handle-space-message/router.test.ts"], { stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
