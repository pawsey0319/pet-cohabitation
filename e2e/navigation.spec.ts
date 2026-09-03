import { test, expect, devices } from "@playwright/test";

// Exercise retained navigation trees, not page.goto() for every destination.
// The deployed JS is real; every account/database/socket request is intercepted
// with synthetic fixtures. This test never creates or modifies a live account.
const user = { id: "00000000-0000-4000-8000-000000000099", email: "navigation@example.test", aud: "authenticated", role: "authenticated", user_metadata: {}, app_metadata: {}, created_at: new Date().toISOString() };
const token = "cfd54a31-09b4-4e40-b605-9f0ea751da13";
const spaceId = "00000000-0000-4000-8000-000000000088";

for (const mobile of [false, true]) {
  test(`notification, pet and pasted invite navigation (${mobile ? "mobile web" : "desktop"})`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ ...(mobile ? devices["Pixel 7"] : devices["Desktop Chrome"]), baseURL });
    try {
      const expires = Math.floor(Date.now() / 1000) + 3600;
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
      // Syntactically valid JWT for client-side decoding only; all auth calls
      // are mocked and this token is never sent to the real backend.
      const accessToken = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, aud: user.aud, role: user.role, exp: expires })}.diagnostic`;
      const session = { access_token: accessToken, refresh_token: "diagnostic-not-a-real-refresh-token", expires_at: expires, expires_in: 3600, token_type: "bearer", user };
      let joinCount = 0;
      await context.route("**/*.supabase.co/**", async route => {
        const path = new URL(route.request().url()).pathname;
        let data: unknown = [];
        if (path === "/auth/v1/user") data = user;
        if (path === "/auth/v1/token") data = session;
        if (path === "/rest/v1/profiles") data = { nickname: "导航测试", is_admin: false };
        if (path === "/rest/v1/rpc/join_space_with_invite") {
          expect(route.request().postDataJSON()).toEqual({ invite_token: token });
          joinCount++;
          data = spaceId;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
      });
      await context.routeWebSocket("**/*.supabase.co/**", ws => {
        ws.onMessage(raw => {
          if (typeof raw !== "string") return;
          const packet = JSON.parse(raw);
          const array = Array.isArray(packet);
          const [joinRef, ref, topic, event, payload] = array ? packet : [packet.join_ref, packet.ref, packet.topic, packet.event, packet.payload];
          const response = event === "phx_join" ? { postgres_changes: (payload.config?.postgres_changes ?? []).map((entry: object, i: number) => ({ ...entry, id: i + 1 })) } : {};
          ws.send(JSON.stringify(array ? [joinRef, ref, topic, "phx_reply", { status: "ok", response }] : { topic, ref, event: "phx_reply", payload: { status: "ok", response } }));
        });
      });
      await context.addInitScript(({ session }) => { localStorage.setItem("sb-lthcucgggoevgcboouqw-auth-token", JSON.stringify(session)); }, { session });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("/chats");
      await expect(page.getByRole("button", { name: "通知", exact: true })).toBeVisible();
      for (let i = 0; i < 3; i++) {
        await page.getByRole("button", { name: "通知", exact: true }).click();
        await expect(page.getByText("暂时没有通知", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "返回", exact: true }).click();
        await expect(page.getByRole("button", { name: "通知", exact: true })).toBeVisible();
      }
      await page.getByRole("tab", { name: /异宠/ }).click();
      await expect(page.getByText("先给异宠一个名字", { exact: true })).toBeVisible();
      await page.getByRole("tab", { name: /消息/ }).click();
      await page.getByRole("button", { name: "通过邀请链接加入群聊", exact: true }).click();
      await page.getByLabel("群邀请链接").fill("ABCDEF123456");
      await page.getByRole("button", { name: "打开群邀请", exact: true }).click();
      await expect(page.getByText("请粘贴完整的群邀请链接，不是注册邀请码。", { exact: true })).toBeVisible();
      await page.getByLabel("群邀请链接").fill(`${new URL(baseURL!).origin}/invite/${token}`);
      await page.getByRole("button", { name: "打开群邀请", exact: true }).click();
      await expect(page.getByRole("button", { name: "接受邀请", exact: true })).toBeVisible();
      expect(joinCount).toBe(0);
      await page.getByRole("button", { name: "接受邀请", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/chat/${spaceId}$`));
      await expect(page.getByLabel("消息内容")).toBeVisible();
      expect(joinCount).toBe(1);
      expect(errors).toEqual([]);
      const geometry = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
      expect(geometry.content).toBeLessThanOrEqual(geometry.width + 1);
    } finally { await context.close(); }
  });
}
