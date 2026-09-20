// Browser layout regression only; the Android OS keyboard also needs device validation.
import assert from "node:assert/strict";
import { chromium, expect as baseExpect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const expect = baseExpect.configure({ timeout: 15000 });
const root = resolve("test-results/mobile-keyboard-web");
const server = createServer(async (req, res) => {
  let path = resolve(root, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
  if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  if (!(await stat(path).catch(() => null))?.isFile()) path = resolve(root, "index.html");
  const types = { ".html": "text/html", ".js": "application/javascript", ".png": "image/png" };
  res.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream" }); res.end(await readFile(path));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function visibleInput(label) {
  const input = page.getByLabel(label);
  await expect(input).toBeVisible();
  await input.fill("键盘弹出时也能看见这段输入\n第二行输入");
  await expect.poll(async () => {
    const bounds = await input.boundingBox();
    return Boolean(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 480);
  }, { message: label + " exceeds reduced viewport" }).toBe(true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}
try {
  await page.goto(base + "/login");
  await page.getByRole("button", { name: "进入本地体验", exact: true }).click();
  await expect(page).toHaveURL(/\/pet/);
  await expect(page.getByRole("button",{name:"通知",exact:true})).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("pet-cohabitation-local-pet-v2", JSON.stringify({
    pet: { id: "local-pet", ownerId: JSON.parse(localStorage.getItem("pet-cohabitation-local-profile-v2") ?? "null")?.id ?? "local-user", name: "键盘测试芽芽", status: "confirmed", currentAssetId: null, confirmedAt: new Date().toISOString() },
    messages: Array.from({ length: 35 }, (_, i) => ({ id: "message-" + i, role: i % 2 ? "pet" : "owner", content: "用于检查长对话布局的测试消息 " + i, createdAt: new Date(Date.now()-86400000).toISOString(), conversationKind:"companion" })),
    assets: [], signals: [], generationDates: [], generationSessions: [], experiences: [], evolutionEvents: [],
  })));
  await page.goto(base + "/pet");
  // A short conversation should put the input immediately after its context.
  await page.evaluate(()=>{
    const owner=JSON.parse(localStorage.getItem("pet-cohabitation-local-profile-v2")).id;
    const key=`pet-cohabitation-local-pet-v2:${owner}`;
    const state=JSON.parse(localStorage.getItem(key)||localStorage.getItem("pet-cohabitation-local-pet-v2"));
    state.messages=[{id:"short-context",role:"pet",content:"这是一段简短的上下文",createdAt:new Date().toISOString(),conversationKind:"companion"}];
    localStorage.setItem(key,JSON.stringify(state));
  });
  await page.reload();
  const shortContext=page.getByText("这是一段简短的上下文",{exact:true});
  await expect(shortContext).toBeVisible();
  await expect.poll(async()=>{
    const context=await shortContext.boundingBox();const input=await page.getByLabel("异宠私聊输入").boundingBox();
    return !!context&&!!input&&input.y>=context.y+context.height&&input.y-context.y-context.height<65&&input.y<400;
  }).toBe(true);
  await page.screenshot({path:"test-results/mobile-companion-context-input.png"});
  const companionInput=page.getByLabel("异宠私聊输入");
  await companionInput.fill("按钮发送后应该清空");
  await page.getByRole("button",{name:"发送私聊",exact:true}).click();
  await expect(companionInput).toHaveValue("");
  await expect(companionInput).toBeEnabled();
  await companionInput.fill("回车发送后也应该清空");
  await companionInput.press("Enter");
  await expect(companionInput).toHaveValue("");
  await expect(companionInput).toBeEnabled();
  await page.reload();
  await expect(companionInput).toBeEnabled();
  await expect(companionInput).toHaveValue("");
  await expect(page.getByText("按钮发送后应该清空",{exact:true})).toHaveCount(1);
  await expect(page.getByText("回车发送后也应该清空",{exact:true})).toHaveCount(1);
  console.log("PASS: button/Enter sends clear the input and stay cleared after reopening, with no duplicates");
  await page.evaluate(()=>{
    const owner=JSON.parse(localStorage.getItem("pet-cohabitation-local-profile-v2")).id;
    const key=`pet-cohabitation-local-pet-v2:${owner}`;
    const state=JSON.parse(localStorage.getItem(key));
    state.messages=Array.from({length:35},(_,i)=>({id:"message-"+i,role:i%2?"pet":"owner",content:"用于检查长对话布局的测试消息 "+i,createdAt:new Date(Date.now()-86400000+i*1000).toISOString(),conversationKind:"companion"}));
    localStorage.setItem(key,JSON.stringify(state));
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 480 });
  await visibleInput("异宠私聊输入");
  await page.screenshot({ path: "test-results/mobile-keyboard-private.png" });
  await page.getByRole("button",{name:"管理记忆",exact:true}).click();
  await page.getByRole("button",{name:"记下一件事",exact:true}).click();
  const memory=page.getByLabel("个人记忆内容");
  await memory.fill("我喜欢茶");
  await expect.poll(async()=>{const b=await memory.boundingBox();return !!b&&b.y>=0&&b.y+b.height<=480;}).toBe(true);
  await page.getByRole("button",{name:"保存记忆",exact:true}).click();
  await page.getByRole("button",{name:"返回聊天",exact:true}).click();
  await page.getByRole("tab",{name:"消息管家",exact:true}).click();
  await expect(page.getByText("用于检查长对话布局的测试消息 34", {exact:true})).not.toBeVisible();
  await visibleInput("异宠私聊输入");
  await page.screenshot({path:"test-results/mobile-keyboard-steward.png"});
  console.log("PASS: default companion, memory editor, and steward composers fit reduced viewport");
  await page.goto(base + "/chats");
  await page.getByRole("button", { name: "新建关系空间", exact: true }).click();
  await page.getByPlaceholder("给这个空间起个名字").fill("键盘验收");
  await page.getByRole("button", { name: "创建空间", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\//);
  await expect(page.getByText("新建关系空间", { exact: true })).not.toBeVisible();
  await visibleInput("消息内容");
  await page.screenshot({ path: "test-results/mobile-keyboard-group.png" });
  await page.getByRole("button", { name: "打开空间主 Agent", exact: true }).click();
  await visibleInput("主 Agent 请求内容");
  await expect.poll(async () => {
    const bounds = await page.getByRole("button", { name: "提交给主 Agent", exact: true }).boundingBox();
    return Boolean(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 480);
  }).toBe(true);
  await page.screenshot({ path: "test-results/mobile-keyboard-agent.png" });
  console.log("PASS: group and Agent composers visible within reduced viewport");
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: "test-results/mobile-keyboard-failure.png" });
  throw error;
} finally {
  await browser.close(); await new Promise((done) => server.close(done));
}
