import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, sep } from "node:path";
const workspace = process.cwd(), base = resolve(workspace, "test-results"), target = resolve(base, `desktop-pet-android-${Date.now()}`);
if (!target.startsWith(base + sep)) throw new Error("Isolated target must remain inside test-results");
await mkdir(target, { recursive: true });
for (const name of ["app.json", "package.json", "package-lock.json", "assets", "modules"]) await cp(resolve(workspace, name), resolve(target, name), { recursive: true });
await symlink(resolve(workspace, "node_modules"), resolve(target, "node_modules"), process.platform === "win32" ? "junction" : "dir");
const config = JSON.parse(await readFile(resolve(workspace, "app.json"), "utf8"));
if (config.expo.android?.googleServicesFile) await cp(resolve(workspace, config.expo.android.googleServicesFile), resolve(target, config.expo.android.googleServicesFile));
const report = { target, checks: {}, nativeCompile: "not run: requires Android SDK and JDK", deviceAcceptance: "not run" };
for (const [name, args] of [["autolinking", ["expo-modules-autolinking", "resolve", "--platform", "android", "--json"]], ["prebuild", ["expo", "prebuild", "--platform", "android", "--no-install"]]]) {
  const result = spawnSync(process.platform === "win32" ? "cmd.exe" : "npx", process.platform === "win32" ? ["/d", "/s", "/c", `npx ${args.join(" ")}`] : args, { cwd: target, env: { ...process.env, EXPO_NO_DOTENV: "1", CI: "1" }, encoding: "utf8", windowsHide: true, maxBuffer: 12 * 1024 * 1024 });
  await writeFile(resolve(target, `${name}.log`), (result.stdout || "") + (result.stderr || "")); report.checks[name] = result.status;
  if (result.status !== 0) process.exitCode = 1;
  if (name === "autolinking" && !result.stdout?.includes("PetDesktopModule")) { report.checks.desktopModuleLinked = false; process.exitCode = 1; }
  else if (name === "autolinking") report.checks.desktopModuleLinked = true;
}
await writeFile(resolve(target, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
