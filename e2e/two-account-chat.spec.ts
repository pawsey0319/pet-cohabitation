import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

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

test("two browser accounts invite, chat, reply, react and receive an Agent summary", async ({ browser }) => {
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

    await pageB.getByPlaceholder("发消息…").fill("收到，这是浏览器乙的实时回复");
    await pageB.getByRole("button", { name: "发送消息" }).click();
    await expect(pageA.getByText("收到，这是浏览器乙的实时回复")).toBeVisible();

    await pageB.getByText("你好，这是浏览器甲发来的消息").click();
    await pageB.getByRole("button", { name: "回复消息" }).click();
    await pageB.getByPlaceholder("发消息…").fill("这条是同空间引用回复");
    await pageB.getByRole("button", { name: "发送消息" }).click();
    await expect(pageA.getByText("这条是同空间引用回复")).toBeVisible();

    await pageA.getByText("收到，这是浏览器乙的实时回复").click();
    await pageA.getByRole("button", { name: "回应 ❤️" }).click();
    await expect(pageB.getByText("❤️ 1")).toBeVisible();

    await pageA.getByRole("button", { name: "聊天更多功能" }).click();
    await pageA.getByText("群聊总结", { exact: true }).click();
    await expect(pageA.getByText(/已确认/).last()).toBeVisible();
    await expect(pageA.getByText(/待本人确认/).last()).toBeVisible();
  } finally {
    await contextA.close().catch(() => undefined); await contextB.close().catch(() => undefined);
  }
});

test("owner incubates, confirms and cares for the same living pet without manual evolution", async ({ browser }) => {
  const context = await browser.newContext(); const page = await context.newPage();
  try {
    await login(page, users[0]);
    await page.goto("/pet");
    await page.getByPlaceholder("例如：芽芽").fill("星芽");
    await page.getByRole("button", { name: "开始对话" }).click();
    for (let turn = 1; turn <= 5; turn += 1) {
      const input = page.getByPlaceholder("说说你喜欢怎样相处…");
      const send = page.getByText("发送", { exact: true }).locator("..");
      await input.fill(`第 ${turn} 次相处：我喜欢先观察，再说出真实感受。`);
      await expect(send).toHaveCSS("opacity", "1");
      await send.click();
      await expect(page.getByText(`${turn} / 5 轮`)).toBeVisible();
    }
    await page.getByRole("button", { name: "生成第一张候选" }).click();
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

    const recallInput = page.getByPlaceholder("问问它记得哪些相处和群聊…");
    const recallSend = page.getByText("发送", { exact: true }).locator("..");
    await recallInput.fill("你还记得我之前在双浏览器小窝里说了什么吗？");
    await expect(recallSend).toHaveCSS("opacity", "1");
    await recallSend.click();
    await expect.poll(async () => {
      const latest = await service.from("pet_private_threads").select("recall_sources").eq("owner_id", users[0].id).eq("role", "pet").order("created_at", { ascending: false }).limit(1).single();
      return Array.isArray(latest.data?.recall_sources) ? latest.data.recall_sources.length : 0;
    }).toBeGreaterThan(0);
    await expect(page.getByText(/记忆来源：双浏览器小窝/)).toBeVisible();

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
