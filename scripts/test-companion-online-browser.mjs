// Build the app against the isolated local Supabase URL first (not demo mode).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium, expect as baseExpect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) throw new Error("Local Supabase URL and service key required");
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const ok = (result) => { if (result.error) throw new Error(result.error.message); return result.data; };
const root = resolve("test-results/companion-web");
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  try {
    let file = resolve(root, `.${decodeURIComponent(new URL(req.url, "http://localhost").pathname)}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) { res.writeHead(403); res.end(); return; }
    if (!(await stat(file).catch(() => null))?.isFile()) file = resolve(root, "index.html");
    res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" }); res.end(await readFile(file));
  } catch { res.writeHead(500); res.end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const users = [];
const pages = [];
const errors = [];
const expect = baseExpect.configure({ timeout: 15_000 });

async function createUser(label) {
  const email = `companion-browser-${label}-${randomUUID()}@example.test`;
  const password = `Test-${randomUUID()}-1a!`;
  const user = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user;
  users.push(user.id);
  ok(await service.from("profiles").insert({ id: user.id, email, nickname: label }));
  const pet = ok(await service.from("pets").insert({ owner_id: user.id, name: `${label}芽芽` }).select("id").single());
  return { id: user.id, email, password, petId: pet.id };
}
async function login(user, mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
  const page = await context.newPage(); pages.push(page);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/login`);
  await page.getByLabel("邮箱", { exact: true }).fill(user.email);
  await page.getByLabel("密码", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/chats/);
  await page.goto(`${base}/pet`);
  await expect(page.getByLabel("异宠私聊输入")).toBeVisible();
  await page.getByRole("button", { name: "查看偏好", exact: true }).click();
  return page;
}
async function send(page, text) {
  const input = page.getByLabel("异宠私聊输入");
  await expect(input).toBeEditable(); await input.fill(text); await input.press("Enter");
  await expect(input).toHaveValue("");
}
try {
  const owner = await createUser("owner");
  const outsider = await createUser("other");
  const first = await login(owner);
  const second = await login(owner, true);
  const other = await login(outsider);
  await send(first, "我喜欢咖啡");
  await expect(first.getByRole("button", { name: "查看依据：咖啡", exact: true })).toBeVisible();
  await expect(second.getByRole("button", { name: "查看依据：咖啡", exact: true })).toBeVisible();
  await second.getByRole("button", { name: "标记重要：咖啡", exact: true }).click();
  await expect(first.getByText("你标记为重要", { exact: false })).toBeVisible();
  await second.getByRole("button", { name: "改变偏好：咖啡", exact: true }).click();
  await second.getByRole("button", { name: "确认偏好变化", exact: true }).click();
  await expect(first.getByText("曾经喜欢 · 现在不推荐", { exact: true })).toBeVisible();
  await first.getByRole("button", { name: "查看依据：咖啡", exact: true }).click();
  await expect(first.getByText("咖啡 · 变化依据", { exact: true })).toBeVisible();
  await expect(first.getByText("我喜欢咖啡", { exact: true }).last()).toBeVisible();
  await first.getByRole("button", { name: "关闭依据", exact: true }).click();
  await expect(first.getByRole("button", { name: "关闭依据", exact: true })).toHaveCount(0);
  assert.equal(await second.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await first.screenshot({ path: "test-results/companion-supabase-desktop.png" });
  await second.screenshot({ path: "test-results/companion-supabase-mobile.png" });
  console.log("PASS: real login, auto extraction and second-browser Realtime preference management");

  // Lose a successful Edge HTTP response; the browser must persist and reuse its ID.
  const lostText = "我明天准备面试，请陪我理清思路";
  const sentIds = [];
  first.on("request", (request) => {
    if (request.url().endsWith("/functions/v1/pet-chat") && request.method() === "POST") {
      const body = request.postDataJSON(); if (body.content === lostText) sentIds.push(body.request_id);
    }
  });
  await first.route("**/functions/v1/pet-chat", async (route) => {
    const committed = await route.fetch(); assert.equal(committed.status(), 200);
    await route.abort("failed");
  }, { times: 1 });
  const input = first.getByLabel("异宠私聊输入");
  await input.fill(lostText); await input.press("Enter");
  await expect(first.getByRole("alert")).toBeVisible();
  await expect(input).toHaveValue(lostText);
  const savedDraft = await first.evaluate((key) => JSON.parse(localStorage.getItem(key)), `pet-cohabitation-private-draft:${owner.id}`);
  assert.equal(savedDraft.id, sentIds[0]);
  await first.reload();
  await expect(first.getByLabel("异宠私聊输入")).toHaveValue(lostText);
  await first.getByLabel("异宠私聊输入").press("Enter");
  await expect(first.getByLabel("异宠私聊输入")).toHaveValue("");
  assert.equal(sentIds.length, 2); assert.equal(sentIds[0], sentIds[1]);
  const stored = ok(await service.from("pet_private_threads").select("id").eq("pet_id", owner.petId).eq("role", "owner").eq("content", lostText));
  assert.equal(stored.length, 1);
  console.log("PASS: lost successful response, page refresh and retry reuse one request and one message");

  await first.getByRole("button", { name: "查看偏好", exact: true }).click();
  await first.getByRole("button", { name: "纠正偏好：咖啡", exact: true }).click();
  await first.getByRole("button", { name: "确认纠正理解", exact: true }).click();
  await expect(second.getByRole("button", { name: "查看依据：咖啡", exact: true })).toHaveCount(0);
  await expect(first.getByText(lostText, { exact: true })).toBeVisible();
  assert.equal(ok(await service.from("pet_companion_states").select("context_started_at").eq("pet_id", owner.petId).single()).context_started_at, null);
  await expect(other.getByRole("button", { name: "查看依据：咖啡", exact: true })).toHaveCount(0);
  await expect(other.getByText(lostText, { exact: true })).toHaveCount(0);
  await first.getByRole("button", { name: "开启新话题", exact: true }).click();
  await first.getByRole("button", { name: "开始新话题", exact: true }).click();
  await expect(second.getByText("新的话题，从你想说的地方开始。你保存的记忆仍会保留。", { exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log("PASS: correction keeps unrelated dialogue, explicit new topic syncs and other account remains isolated");
} catch (error) {
  await pages[0]?.screenshot({ path: "test-results/companion-supabase-browser-failure.png" });
  throw error;
} finally {
  await browser.close(); await new Promise((done) => server.close(done));
  for (const id of users) ok(await service.auth.admin.deleteUser(id));
}
