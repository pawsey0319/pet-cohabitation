// Build with EXPO_PUBLIC_DEMO_MODE=true and EXPO_NO_DOTENV=1 first.
// Serves only the local dist directory, then closes its temporary browser/server.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium, expect } from "@playwright/test";

const root = resolve("dist");
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  try {
    let file = resolve(root, `.${decodeURIComponent(new URL(req.url, "http://localhost").pathname)}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) { res.writeHead(403); res.end(); return; }
    if (!(await stat(file).catch(() => null))?.isFile()) file = resolve(root, "index.html");
    res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch { res.writeHead(500); res.end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = []; page.on("pageerror", (error) => errors.push(error.message));
const storageKey = "pet-cohabitation-local-pet-v2:00000000-0000-4000-8000-000000000001";
const savedState = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
const send = async (text) => {
  const input = page.getByLabel("异宠私聊输入");
  await input.fill(text); await input.press("Enter");
  await expect(input).toHaveValue("");
};
try {
  await page.goto(`${base}/login`);
  await page.getByRole("button", { name: "进入本地体验" }).click();
  await expect(page).toHaveURL(/\/chats/);
  await page.goto(`${base}/pet`);
  await page.getByPlaceholder("例如：芽芽").fill("芽芽");
  await page.getByRole("button", { name: "开始对话", exact: true }).click();
  for (const text of ["我喜欢慢慢聊天", "有时候我只想被听见", "我喜欢一起观察生活", "你可以好奇一点", "我们慢慢认识", "我累的时候先听我说"]) await send(text);
  await page.getByRole("button", { name: "记住这句：我累的时候先听我说", exact: true }).click();
  await page.getByLabel("个人记忆内容").fill("我累的时候先听我说，别急着给建议。");
  await page.getByRole("button", { name: "保存记忆", exact: true }).click();
  await expect(page.getByLabel("个人记忆内容")).toBeHidden();
  assert.equal((await savedState()).personalMemories.length, 1);
  await page.getByRole("button", { name: "生成第一张候选", exact: true }).click();
  await page.getByRole("button", { name: "选择这张并确认", exact: true }).click();
  await page.getByRole("button", { name: "我确认这是它", exact: true }).click();
  await expect(page.getByPlaceholder("今天有什么想和它说的…")).toBeVisible();
  await send("你记得我的偏好吗");
  assert.match((await savedState()).messages.at(-1).content, /别急着给建议/);
  await page.getByRole("button", { name: "编辑记忆：我累的时候先听我说，别急着给建议。", exact: true }).click();
  await page.getByLabel("个人记忆内容").fill("现在我更希望一起想具体办法。");
  await page.getByRole("button", { name: "保存记忆", exact: true }).click();
  await expect(page.getByLabel("个人记忆内容")).toBeHidden();
  await send("你记得我的偏好吗");
  assert.match((await savedState()).messages.at(-1).content, /具体办法/);
  assert.doesNotMatch((await savedState()).messages.at(-1).content, /别急着/);
  await page.getByRole("button", { name: "移出记忆：现在我更希望一起想具体办法。", exact: true }).click();
  await page.getByRole("button", { name: "确认移出记忆", exact: true }).click();
  await expect(page.getByText("把这件事移出记忆？")).toBeHidden();
  assert.equal((await savedState()).personalMemories.length, 0);
  await send("我以前喜欢咖啡，现在更喜欢茶");
  await page.getByRole("button",{name:"查看偏好",exact:true}).click();
  await page.getByRole("button",{name:"查看依据：茶",exact:true}).click();
  await expect(page.getByText("茶 · 变化依据",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"关闭依据",exact:true}).click();
  await page.getByRole("button",{name:"标记重要：茶",exact:true}).click();
  assert.ok((await savedState()).importantKeys.includes("茶|global"));
  await page.getByRole("button",{name:"改变偏好：茶",exact:true}).click();
  await page.getByRole("button",{name:"确认偏好变化",exact:true}).click();
  await expect(page.getByText("记下你的变化",{exact:true})).toBeHidden();
  assert.equal((await savedState()).evidence.at(-1).polarity,"negative");
  await page.getByRole("button",{name:"改变偏好：茶",exact:true}).click();
  await page.getByRole("button",{name:"确认偏好变化",exact:true}).click();
  await expect(page.getByText("记下你的变化",{exact:true})).toBeHidden();
  assert.equal((await savedState()).evidence.at(-1).polarity,"positive");
  await page.getByRole("button",{name:"忘记偏好：茶",exact:true}).click();
  await page.getByRole("button",{name:"确认忘记偏好",exact:true}).click();
  await expect(page.getByText("忘记这项偏好？",{exact:true})).toBeHidden();
  assert.ok((await savedState()).evidence.filter(v=>v.object==="茶").every(v=>v.state==="forgotten"));
  await send("我现在喜欢果汁");
  await page.getByRole("button",{name:"纠正偏好：果汁",exact:true}).click();
  await page.getByRole("button",{name:"确认纠正理解",exact:true}).click();
  await expect(page.getByText("纠正这项理解？",{exact:true})).toBeHidden();
  assert.ok((await savedState()).evidence.filter(v=>v.object==="果汁").every(v=>v.state==="retracted"));
  assert.equal((await savedState()).contextStartedAt??null,null,"memory operations must keep the conversation");
  await send("明天我要参加设计岗位的面试");
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    const offset = 7 * 60 * 60 * 1000;
    state.messages = state.messages.map((item) => ({ ...item, createdAt: new Date(Date.parse(item.createdAt) - offset).toISOString() }));
    if(state.contextStartedAt) state.contextStartedAt = new Date(Date.parse(state.contextStartedAt) - offset).toISOString();
    localStorage.setItem(key, JSON.stringify(state));
  }, storageKey);
  const count = (await savedState()).messages.length;
  await page.reload();
  await expect(page.getByText("欢迎回来，慢慢接着聊", { exact: true })).toBeVisible();
  assert.equal((await savedState()).messages.length, count, "opening must not generate an unsolicited turn");
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/companion-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/companion-mobile.png" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "no horizontal overflow on mobile");
  await page.getByRole("button", { name: "接着聊这件事", exact: true }).click();
  await expect(page.getByLabel("异宠私聊输入")).toHaveValue("我想接着聊这件事：明天我要参加设计岗位的面试");
  await page.getByRole("button", { name: "开启新话题", exact: true }).click();
  await page.getByRole("button", { name: "开始新话题", exact: true }).click();
  await expect(page.getByLabel("异宠私聊输入")).toHaveValue("");
  await page.reload();
  await expect(page.getByText("新的话题，从你想说的地方开始。你保存的记忆仍会保留。", { exact: true })).toBeVisible();
  await expect(page.getByText("欢迎回来，慢慢接着聊", { exact: true })).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log("PASS: local browser incubation, Enter send, pin/edit/remove, corrected replies, sourced reunion, new topic, mobile layout; no page errors.");
} catch (error) {
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/companion-failure.png" });
  throw error;
} finally { await browser.close(); await new Promise((done) => server.close(done)); }
