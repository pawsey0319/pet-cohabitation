import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const base = process.env.MODULE_UI_BASE ?? "http://127.0.0.1:50521";
if (new URL(base).hostname !== "127.0.0.1") throw new Error("local_demo_preview_required");
const out = resolve("test-results/module-layout-20260920"); await mkdir(out, { recursive: true });
const browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errors = [], checks = []; const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
await context.route("**/*.supabase.co/**", route => route.abort());
await context.addInitScript(() => {
  if (localStorage.getItem("module-layout-fixture-v1")) return;
  const owner = "00000000-0000-4000-8000-000000000001", pet = "local-pet", now = new Date().toISOString();
  localStorage.setItem("pet-cohabitation-local-profile-v2", JSON.stringify({ id: owner, email: "layout@example.test", nickname: "界面验收", isAdmin: true }));
  localStorage.setItem(`pet-cohabitation-local-pet-v2:${owner}`, JSON.stringify({
    pet: { id: pet, ownerId: owner, name: "新版验收小陶", status: "confirmed", currentAssetId: "local-asset", confirmedAt: now },
    messages: [{ id: "source-1", role: "owner", content: "最近喜欢喝茶，想找个安静的地方读书。", createdAt: new Date(Date.now() - 2000).toISOString(), conversationKind: "companion" }, { id: "reply-1", role: "pet", content: "可以慢慢读。找个安静的位置，给自己留一点不用赶路的时间。", createdAt: new Date(Date.now() - 1000).toISOString(), conversationKind: "companion" }, { id: "legacy-1", role: "owner", content: "早期消息管家测试记录", createdAt: now, conversationKind: "steward" }],
    assets: [{ id: "local-asset", petId: pet, ownerId: owner, storagePath: "local-fixture-pet", isDraft: false, createdAt: now }],
    signals: [], generationDates: [], generationSessions: [], experiences: [], evolutionEvents: [],
    personalMemories: [{ id: "memory-1", content: "我喜欢安静地读书", sourceMessageId: "source-1", createdAt: now, updatedAt: now }],
  }));
  localStorage.setItem("module-layout-fixture-v1", "1");
});
async function shot(name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name}: horizontal overflow`);
  await page.screenshot({ path: resolve(out, `${name}.png`) }); checks.push(name);
}
async function goto(path) { await page.goto(`${base}${path}`); }
async function checkLatestVisible() {
  await expect.poll(async () => {
    const last = await page.getByText("可以慢慢读。找个安静的位置，给自己留一点不用赶路的时间。", { exact: true }).boundingBox();
    const viewport = await page.getByTestId("companion-transcript").boundingBox();
    return Boolean(last && viewport && last.y + last.height <= viewport.y + viewport.height + 1 && last.y + last.height > viewport.y);
  }).toBe(true);
}
try {
  await goto("/pet"); await expect(page.getByLabel("异宠私聊输入")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("tab", { name: "消息管家", exact: true })).toHaveCount(0);
  const message = await page.getByText("可以慢慢读。找个安静的位置，给自己留一点不用赶路的时间。", { exact: true }).boundingBox();
  const composer = await page.getByLabel("异宠私聊输入").boundingBox();
  assert(message && composer && composer.y >= message.y + message.height && composer.y - message.y - message.height < 190, "composer follows actual context");
  await shot("01-companion-390-light");
  await page.getByLabel("异宠私聊输入").fill("切换设置前保留的草稿");
  await page.getByRole("tab", { name: "记忆", exact: true }).click(); await expect(page).toHaveURL(/pet-memory/);
  await expect(page.getByText("你主动保存的记忆", { exact: true })).toBeVisible();
  await shot("02-memory-390-light"); await page.getByRole("button", { name: "记下一件事", exact: true }).click();
  await page.getByLabel("个人记忆内容").fill("界面验收中新增的记忆"); await page.getByRole("button", { name: "保存记忆", exact: true }).click();
  await expect(page.getByText("界面验收中新增的记忆", { exact: true })).toBeVisible();
  await page.getByText("界面验收中新增的记忆", { exact: true }).locator("..").getByRole("button", { name: "纠正", exact: true }).click();
  await page.getByLabel("个人记忆内容").fill("界面验收已纠正的记忆"); await page.getByRole("button", { name: "保存记忆", exact: true }).click();
  await expect(page.getByText("界面验收已纠正的记忆", { exact: true })).toBeVisible();
  await page.getByText("界面验收已纠正的记忆", { exact: true }).locator("..").getByRole("button", { name: "忘记", exact: true }).click();
  await page.getByRole("button", { name: "确认忘记", exact: true }).click(); await expect(page.getByText("界面验收已纠正的记忆", { exact: true })).toHaveCount(0);
  await page.getByLabel("返回异宠").click(); await expect(page.getByLabel("异宠私聊输入")).toHaveValue("切换设置前保留的草稿");
  await page.getByRole("tab", { name: "成长", exact: true }).click(); await expect(page).toHaveURL(/pet-growth/);
  await expect(page.getByText("性格变化", { exact: true })).toBeVisible(); await shot("03-growth-390-light");
  await page.getByRole("tab", { name: "桌宠", exact: true }).click(); await expect(page).toHaveURL(/pet-desktop/);
  await expect(page.getByText(/Windows 桌宠需安装独立桌宠程序/)).toBeVisible(); await shot("04-desktop-honest-web-state");
  await goto("/pet-settings"); await expect(page.getByText("回答组织方式", { exact: true })).toBeVisible(); await shot("05-interaction-settings");
  await page.getByText("历史对话", { exact: true }).click(); await expect(page.getByText("早期消息管家测试记录", { exact: true })).toBeVisible(); await shot("06-history-legacy-readable");
  await goto("/me"); await expect(page.getByText("外观与显示", { exact: true })).toBeVisible();
  await expect(page.getByText("回应偏好", { exact: true })).toHaveCount(0); await shot("07-me-no-duplicate-pet-settings");
  await page.getByText("外观与显示", { exact: true }).click(); await page.getByRole("button", { name: "使用暖夜主题", exact: true }).click(); await page.getByRole("button", { name: "保存", exact: true }).click();
  await goto("/pet"); await expect.poll(() => page.evaluate(() => document.documentElement.style.colorScheme)).toBe("dark"); await expect(page.getByLabel("异宠私聊输入")).toBeVisible(); await shot("08-companion-390-dark");
  await page.setViewportSize({ width: 320, height: 720 }); await checkLatestVisible(); await shot("09-companion-320-dark");
  await page.getByTestId("companion-transcript").hover(); await page.mouse.wheel(0, -1000);
  await expect.poll(() => page.getByTestId("companion-transcript").evaluate(element => element.scrollTop)).toBe(0);
  await page.setViewportSize({ width: 335, height: 700 });
  await expect.poll(() => page.getByTestId("companion-transcript").evaluate(element => element.scrollTop)).toBe(0);
  await shot("09b-history-reading-position-preserved"); await page.setViewportSize({ width: 320, height: 720 });
  await page.getByRole("tab", { name: "记忆", exact: true }).click(); await expect(page.getByText("你主动保存的记忆", { exact: true })).toBeVisible(); await shot("10-memory-320-dark");
  await goto("/pet-settings"); await expect(page.getByText("回答组织方式", { exact: true })).toBeVisible(); await shot("11-settings-320-dark");
  await goto("/pet?section=steward"); await expect(page.getByLabel("异宠私聊输入")).toBeVisible(); await expect(page.getByRole("tab", { name: "消息管家", exact: true })).toHaveCount(0); await shot("12-steward-link-compatible");
  await page.setViewportSize({ width: 390, height: 440 }); await page.getByLabel("异宠私聊输入").focus(); await expect(page.getByLabel("发送私聊")).toBeVisible(); await checkLatestVisible(); await shot("13-small-keyboard-viewport");
  await page.setViewportSize({ width: 390, height: 844 });
  await goto("/pet-personality"); await expect(page.getByText("登录真实账号后，可以查看和管理有来源的性格学习。", { exact: true })).toBeVisible(); await shot("14-personality-demo-boundary");
  await goto("/pet-relations?spaceId=synthetic-group"); await expect(page.getByText("登录真实账号后可以管理群关系理解与授权。", { exact: true })).toBeVisible(); await shot("15-relations-demo-boundary");
  assert.deepEqual(errors, []); await writeFile(resolve(out, "report.json"), JSON.stringify({ success: true, checks, errors, scope: "Synthetic local demo only; browser layout/navigation/memory CRUD/draft persistence, not real models/native overlay/device acceptance." }, null, 2));
  console.log(`PASS ${checks.length} layout/navigation screenshots and interactions`);
} catch (error) {
  await page.screenshot({ path: resolve(out, "failure.png") });
  await writeFile(resolve(out, "report.json"), JSON.stringify({ success: false, checks, errors, failure: String(error) }, null, 2)); throw error;
} finally { await browser.close(); }
