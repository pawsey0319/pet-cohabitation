import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";

const supabaseUrl = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = Date.now();
const users = [
  { email: `browser-a-${suffix}@example.test`, password: `Browser-a-${suffix}`, nickname: "浏览器甲", id: "" },
  { email: `browser-b-${suffix}@example.test`, password: `Browser-b-${suffix}`, nickname: "浏览器乙", id: "" },
];
let createdSpaceId = "";

async function login(page: Page, user: typeof users[number]) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(user.email);
  await page.getByLabel("密码").fill(user.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/chats/);
  await expect(page.getByText("消息", { exact: true }).first()).toBeVisible();
}

async function listMetrics(page: Page) {
  return page.getByTestId("chat-message-list").evaluate((element) => ({
    top: element.scrollTop,
    height: element.clientHeight,
    content: element.scrollHeight,
    distance: element.scrollHeight - element.clientHeight - element.scrollTop,
  }));
}

async function scrollList(page: Page, position: "top" | "bottom") {
  await page.getByTestId("chat-message-list").evaluate((element, target) => {
    element.scrollTop = target === "top" ? 0 : element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, position);
  await page.waitForTimeout(150);
}

test.beforeAll(async () => {
  for (const user of users) {
    const created = await service.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true });
    if (created.error) throw created.error;
    user.id = created.data.user.id;
    const profile = await service.from("profiles").insert({ id: user.id, email: user.email, nickname: user.nickname });
    if (profile.error) throw profile.error;
  }
});

test.afterAll(async () => {
  if (createdSpaceId) await service.from("spaces").delete().eq("id", createdSpaceId);
  for (const user of users) if (user.id) await service.auth.admin.deleteUser(user.id);
});

test("two browser accounts invite, chat, reply, react and use the shared Agent workbench", async ({ browser }) => {
  const contextA: BrowserContext = await browser.newContext();
  const contextB: BrowserContext = await browser.newContext();
  const pageA = await contextA.newPage(); const pageB = await contextB.newPage();
  try {
    await login(pageA, users[0]);
    await pageA.getByRole("button", { name: "新建关系空间" }).click();
    await pageA.getByPlaceholder("给这个空间起个名字").fill("双浏览器小窝");
    await pageA.getByRole("button", { name: "创建空间" }).click();
    await expect(pageA).toHaveURL(/\/chat\/[0-9a-f-]+/);
    createdSpaceId = new URL(pageA.url()).pathname.split("/").at(-1)!;

    const composerA = pageA.getByPlaceholder("发消息…");
    await composerA.fill("你好，这是浏览器甲发来的消息");
    await expect(pageA.getByRole("button", { name: "发送消息" })).toBeEnabled();
    await expect(composerA).toHaveAttribute("data-enter-listener", "attached");
    await composerA.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, shiftKey: false });
    await expect(composerA).toHaveAttribute("data-enter-submit", "handled");
    await expect(composerA).toHaveValue("");
    await expect(pageA.getByText("你好，这是浏览器甲发来的消息")).toBeVisible();

    await pageA.getByRole("button", { name: "聊天更多功能" }).click();
    await pageA.getByText("邀请成员", { exact: true }).click();
    const inviteText = pageA.getByText(/https?:\/\/[^\s]+\/invite\/[0-9a-f-]+/);
    await expect(inviteText).toBeVisible();
    const inviteUrl = await inviteText.textContent();
    expect(new URL(inviteUrl!).origin).toBe(new URL(process.env.E2E_BASE_URL ?? "http://127.0.0.1:8082").origin);
    await pageA.getByRole("button", { name: "完成" }).click();

    await login(pageB, users[1]);
    await pageB.goto(inviteUrl!);
    await pageB.getByRole("button", { name: "接受邀请" }).click();
    await expect(pageB).toHaveURL(new RegExp(`/chat/${createdSpaceId}`));
    await expect(pageB.getByText("你好，这是浏览器甲发来的消息")).toBeVisible();

    const composerBoxBefore = await pageB.getByPlaceholder("发消息…").boundingBox();
    await pageB.getByPlaceholder("发消息…").fill("收到，这是浏览器乙的实时回复");
    await pageB.getByRole("button", { name: "发送消息" }).click();
    await expect(pageA.getByText("收到，这是浏览器乙的实时回复")).toBeVisible();
    const composerBoxAfter = await pageB.getByPlaceholder("发消息…").boundingBox();
    expect(Math.abs((composerBoxAfter?.y ?? 0) - (composerBoxBefore?.y ?? 0))).toBeLessThan(3);

    const filler = Array.from({ length: 70 }, (_, index) => ({
      client_id: `browser-scroll-${suffix}-${index}`, space_id: createdSpaceId, sender_id: null,
      actor_kind: "space_agent", actor_id: createdSpaceId, actor_name: "空间记录", kind: "system",
      text: `滚动测试记录 ${index + 1}`, permission_source: "browser_scroll_seed",
      created_at: new Date(Date.now() + index).toISOString(),
    }));
    expect((await service.from("messages").insert(filler)).error).toBeNull();
    await pageB.reload();
    await expect(pageB.getByText("滚动测试记录 70")).toBeVisible();
    await scrollList(pageB, "bottom");
    const bottomComposerBefore = await pageB.getByPlaceholder("发消息…").boundingBox();
    await pageB.getByPlaceholder("发消息…").fill("我在底部发送后仍然看得到自己");
    await pageB.getByRole("button", { name: "发送消息" }).click();
    const bottomMessage = pageB.getByText("我在底部发送后仍然看得到自己");
    await expect(bottomMessage).toBeVisible();
    await expect.poll(async () => (await listMetrics(pageB)).distance).toBeLessThan(48);
    const bottomComposerAfter = await pageB.getByPlaceholder("发消息…").boundingBox();
    expect(Math.abs((bottomComposerAfter?.y ?? 0) - (bottomComposerBefore?.y ?? 0))).toBeLessThan(3);
    expect((await bottomMessage.boundingBox())!.y).toBeLessThan(bottomComposerAfter!.y);

    await scrollList(pageB, "top");
    expect((await listMetrics(pageB)).distance).toBeGreaterThan(100);
    await pageB.getByPlaceholder("发消息…").fill("我从历史位置发送也会回到最新消息");
    await pageB.getByRole("button", { name: "发送消息" }).click();
    await expect(pageB.getByText("我从历史位置发送也会回到最新消息")).toBeVisible();
    await expect.poll(async () => (await listMetrics(pageB)).distance).toBeLessThan(48);

    await scrollList(pageA, "top");
    const readingBeforeIncoming = await listMetrics(pageA);
    await pageB.getByPlaceholder("发消息…").fill("这条新消息不能抢走甲的历史阅读位置");
    await pageB.getByRole("button", { name: "发送消息" }).click();
    await expect(pageA.getByText("有新消息 ↓")).toBeVisible();
    const readingAfterIncoming = await listMetrics(pageA);
    expect(Math.abs(readingAfterIncoming.top - readingBeforeIncoming.top)).toBeLessThan(8);
    await pageA.getByText("有新消息 ↓").click();

    await pageB.getByText("滚动测试记录 70").click();
    await pageB.getByRole("button", { name: "回复消息" }).click();
    await pageB.getByPlaceholder("发消息…").fill("这条是同空间引用回复");
    await pageB.getByRole("button", { name: "发送消息" }).click();
    await expect(pageA.getByText("这条是同空间引用回复")).toBeVisible();

    await pageA.getByText("我在底部发送后仍然看得到自己").click();
    await pageA.getByRole("button", { name: "回应 ❤️" }).click();
    await expect(pageB.getByText("❤️ 1")).toBeVisible();

    await pageA.getByRole("button", { name: "打开空间主 Agent" }).click();
    await expect(pageA.getByText("普通聊天不会自动触发。", { exact: false })).toBeVisible();
    await pageA.getByText("群聊简报", { exact: true }).click();
    await pageA.getByRole("button", { name: "提交给主 Agent" }).click();
    await expect(pageA.getByText("已完成", { exact: true }).last()).toBeVisible();
    await expect(pageA.getByText(/主要话题/).last()).toBeVisible();
    await expect(pageA.getByText(/浏览器乙的实时回复/).last()).toBeVisible();

    const scheduledDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    await pageA.getByText("日程安排", { exact: true }).click();
    await pageA.getByPlaceholder("输入你希望主 Agent 完成的事").fill(`安排 ${scheduledDate} 19:30 和浏览器乙线上碰面`);
    await pageA.getByRole("button", { name: "提交给主 Agent" }).click();
    await expect(pageA.getByText("等待投票", { exact: true }).last()).toBeVisible();

    await pageA.getByRole("button", { name: "关闭主 Agent" }).click();
    await expect(pageA.getByText("日程提案").last()).toBeVisible();
    await expect(pageB.getByText("日程提案").last()).toBeVisible();
    await expect(pageB.getByText(/赞成 1 \/ 2/).last()).toBeVisible();
    await pageB.getByRole("button", { name: "赞成日程提案" }).last().click();
    await expect(pageB.getByText("已执行", { exact: true }).last()).toBeVisible();
    await pageA.getByRole("button", { name: "聊天更多功能" }).click();
    const chooserPromise = pageA.waitForEvent("filechooser");
    await pageA.getByText("图片", { exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: "tiny.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nL8AAAAASUVORK5CYII=", "base64") });
    await expect(pageA.getByRole("button", { name: "全屏查看图片" }).last()).toBeVisible();
    await pageA.getByRole("button", { name: "全屏查看图片" }).last().click();
    await expect(pageA.getByText(/双击 \/ 滚轮 \/ 双指缩放/)).toBeVisible();
    await pageA.getByRole("button", { name: "关闭图片预览" }).last().click();
    await expect(pageA.getByText(/双击 \/ 滚轮 \/ 双指缩放/)).toHaveCount(0);
  } finally {
    await contextA.close().catch(() => undefined); await contextB.close().catch(() => undefined);
  }
});

test("owner sets, confirms and cares for the same living pet without incubation chat", async ({ browser }) => {
  const context = await browser.newContext(); const page = await context.newPage();
  try {
    if (!createdSpaceId) {
      const space = await service.from("spaces").insert({ name: "双浏览器小窝", kind: "friend_pair", created_by: users[0].id }).select("id").single();
      if (space.error) throw space.error;
      createdSpaceId = space.data.id;
      const members = await service.from("space_members").insert([
        { space_id: createdSpaceId, user_id: users[0].id, role: "owner" },
        { space_id: createdSpaceId, user_id: users[1].id, role: "member" },
      ]);
      if (members.error) throw members.error;
      const ownerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const signedIn = await ownerClient.auth.signInWithPassword({ email: users[0].email, password: users[0].password });
      if (signedIn.error) throw signedIn.error;
      const message = await ownerClient.from("messages").insert({ client_id: `pet-recall-${suffix}`, space_id: createdSpaceId, sender_id: users[0].id, actor_kind: "human", actor_name: users[0].nickname, kind: "text", text: "你好，这是浏览器甲发来的消息" });
      if (message.error) throw message.error;
    }
    await login(page, users[0]);
    await page.goto("/pet");
    await page.getByPlaceholder("例如：芽芽").fill("星芽");
    await page.getByRole("button", { name: "下一步：填写期待" }).click();
    await expect(page.getByText("不再进行五轮孵化对话")).toHaveCount(0);
    await page.getByPlaceholder(/会收集月光/).fill("像会收集月光的软体生物，有不对称触角和透明鳍");
    await page.getByPlaceholder(/安静敏锐/).fill("安静敏锐，有自己的判断，不一味迎合");
    await page.getByPlaceholder(/平时先倾听/).fill("平时先倾听，需要时直接提醒，也会主动分享见闻");
    await page.getByPlaceholder(/不要人脸/).fill("不要人脸、翅膀和普通猫狗轮廓");
    await page.getByRole("button", { name: "生成第一张异宠" }).click();
    await expect(page.getByText("这是当前草稿，不是最终承诺")).toBeVisible();
    await page.getByRole("button", { name: "选择这张并确认" }).click();
    await page.getByRole("button", { name: "我确认这是它" }).click();
    await expect(page.getByText("它不会再回到初始捏宠")).toBeVisible();

    await expect(page.getByText(/隐藏的成长里程碑达到后自主进入下一生命阶段/)).toBeVisible();
    await expect(page.getByRole("button", { name: /祝福|开启重大进化/ })).toHaveCount(0);

    const petRow = await service.from("pets").select("id").eq("owner_id", users[0].id).single();
    expect(petRow.error).toBeNull();
    const rememberedMessages = await service.from("messages").select("id,text").eq("space_id", createdSpaceId).eq("sender_id", users[0].id);
    expect(rememberedMessages.data?.some((message) => message.text === "你好，这是浏览器甲发来的消息")).toBe(true);
    const petPermission = await service.from("space_pet_permissions").select("pet_id,participation_enabled,proactive_paused,paused_by_vote").eq("space_id", createdSpaceId).eq("pet_id", petRow.data!.id).single();
    expect(petPermission.error).toBeNull();
    expect(petPermission.data?.participation_enabled).toBe(true);
    expect(petPermission.data?.proactive_paused).toBe(false);
    expect(petPermission.data?.paused_by_vote).toBe(false);
    const membership = await service.from("space_members").select("joined_at").eq("space_id", createdSpaceId).eq("user_id", users[0].id).single();
    expect(membership.error).toBeNull();
    const eligibleMessages = await service.from("messages").select("id").eq("space_id", createdSpaceId).eq("sender_id", users[0].id).gte("created_at", membership.data!.joined_at);
    expect(eligibleMessages.data?.length).toBeGreaterThan(0);

    const recallInput = page.getByPlaceholder("问群聊近况，或让它帮你整理委托…");
    const recallSend = page.getByText("发送", { exact: true }).locator("..");
    await recallInput.fill("你还记得我之前在双浏览器小窝里说了什么吗？");
    await expect(recallSend).toHaveCSS("opacity", "1");
    await recallSend.click();
    await expect.poll(async () => {
      const latest = await service.from("pet_private_threads").select("recall_sources").eq("owner_id", users[0].id).eq("role", "pet").order("created_at", { ascending: false }).limit(1).single();
      return Array.isArray(latest.data?.recall_sources) ? latest.data.recall_sources.length : 0;
    }).toBeGreaterThan(0);
    await expect(page.getByText(/消息来源：双浏览器小窝/)).toBeVisible();

    await page.getByRole("button", { name: "投喂" }).click();
    await expect(page.getByLabel("异宠状态：认真进食")).toBeVisible();
    await expect(page.getByText(/小点心/)).toBeVisible();

    await page.getByRole("button", { name: "玩耍" }).click();
    await expect(page.getByLabel("异宠状态：正在玩耍")).toBeVisible();
    await expect(page.getByText(/追光游戏/)).toBeVisible();
    await expect(page.getByText("形态谱系 · 第 1 个生命阶段")).toBeVisible();
  } finally {
    await context.close().catch(() => undefined);
  }
});
