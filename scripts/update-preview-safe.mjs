import { spawnSync } from "node:child_process";
import path from "node:path";

const npmCli = process.env.npm_execpath
  ?? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

function run(args, options = {}) {
  return spawnSync(process.execPath, [npmCli, "exec", "--yes", "--package", "eas-cli", "--", "eas", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options,
  });
}

function fail(message, result) {
  console.error(message);
  if (result?.error) console.error(result.error.message);
  if (result?.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

const listed = run(["env:list", "preview", "--format", "short"]);
if (listed.status !== 0) fail("无法读取 EAS preview 环境，已取消 OTA 发布。", listed);

const previewEnvironment = Object.fromEntries(
  listed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const supabaseUrl = previewEnvironment.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = previewEnvironment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let parsedUrl;
try {
  parsedUrl = new URL(supabaseUrl);
} catch {
  fail("EAS preview 的 EXPO_PUBLIC_SUPABASE_URL 无效，已取消 OTA 发布。");
}

const isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsedUrl.hostname);
if (parsedUrl.protocol !== "https:" || isLoopback) {
  fail(`EAS preview 仍指向非公网地址 ${parsedUrl.protocol}//${parsedUrl.hostname}，已取消 OTA 发布。`);
}
if (!publishableKey) fail("EAS preview 缺少 EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY，已取消 OTA 发布。");
if (previewEnvironment.EXPO_PUBLIC_DEMO_MODE !== "false") {
  fail("EAS preview 未明确关闭 Demo 模式，已取消 OTA 发布。");
}

let authCheck;
try {
  authCheck = await fetch(`${parsedUrl.origin}/auth/v1/settings`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
} catch {
  fail("无法使用 EAS preview 配置连接 Supabase Auth，已取消 OTA 发布。");
}
if (!authCheck.ok) {
  fail(`Supabase 拒绝当前 Publishable Key（HTTP ${authCheck.status}），已取消 OTA 发布。`);
}

console.log(`发布前检查通过：Android 将连接 ${parsedUrl.origin}，API Key 已通过 Auth 验证。`);

const messageIndex = process.argv.indexOf("--message");
const message = messageIndex >= 0 ? process.argv[messageIndex + 1] : "Android preview update";
const isBuild = process.argv.includes("--build");
const published = run(
  isBuild
    ? ["build", "--platform", "android", "--profile", "preview", "--non-interactive"]
    : [
        "update",
        "--channel",
        "preview",
        "--platform",
        "android",
        "--environment",
        "preview",
        "--message",
        message,
      ],
  {
    env: { ...process.env, ...previewEnvironment },
    stdio: "inherit",
  },
);

if (published.status !== 0) process.exit(published.status ?? 1);
