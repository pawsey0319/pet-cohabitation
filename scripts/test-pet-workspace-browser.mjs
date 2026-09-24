import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const base = process.env.MODULE_UI_BASE ?? "http://127.0.0.1:50522";
if (new URL(base).hostname !== "127.0.0.1") throw new Error("local_demo_preview_required");
const out = resolve("test-results/pet-workspace-browser-20260922"); await mkdir(out, { recursive: true });
const browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errors = [], checks = []; const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
await context.route("**/*.supabase.co/**", route => route.abort());
await context.addInitScript(() => {
  if (localStorage.getItem("module-layout-fixture-v1")) return;
  const owner = "00000000-0000-4000-8000-000000000001", pet = "local-pet", now = new Date().toISOString();
  localStorage.setItem("pet-cohabitation-local-profile-v2", JSON.stringify({ id: owner, email: "layout@example.test", nickname: "界面验收", isAdmin: true }));
  localStorage.setItem(`pet-cohabitation-local-pet-v2:${owner}`, JSON.stringify({
    pet: { id: pet, ownerId: owner, name: "新版验收小陶", status: "confirmed", currentAssetId: "local-asset", confirmedAt: now },
    messages: [...Array.from({length:24},(_,index)=>({id:`scroll-${index}`,role:index%2?'pet':'owner',content:`滚动保留测试 ${index}：这段历史用于检验离开陪伴后再回来，仍能停留在正在阅读的位置。`,createdAt:new Date(Date.now()-60000+index*1000).toISOString(),conversationKind:'companion'})),{ id: "source-1", role: "owner", content: "最近喜欢喝茶，想找个安静的地方读书。", createdAt: new Date(Date.now() - 2000).toISOString(), conversationKind: "companion" }, { id: "reply-1", role: "pet", content: "可以慢慢读。找个安静的位置，给自己留一点不用赶路的时间。", createdAt: new Date(Date.now() - 1000).toISOString(), conversationKind: "companion" }, { id: "legacy-1", role: "owner", content: "早期消息管家测试记录", createdAt: now, conversationKind: "steward" }],
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
 await goto("/pet"); await expect(page.getByLabel("异宠私聊输入")).toBeVisible({ timeout: 30000 });
 await expect(page.getByTestId("pet-position-stage")).toHaveCount(0);
 await expect(page.getByLabel("桌面异宠设置")).toHaveCount(0);
 await page.getByLabel("异宠私聊输入").fill("四页切换仍保留的草稿");
 await shot("companion-without-portrait");
 const timings=[];
 for(let round=0;round<20;round++) for(const label of ["记忆","成长","桌宠","陪伴"]) {
   const started=Date.now(); await page.getByRole("tab",{name:label,exact:true}).click();
   await expect(page.getByRole("tab",{name:label,exact:true})).toHaveAttribute("aria-selected","true");
   if(label==="陪伴") await expect(page.getByLabel("异宠私聊输入")).toHaveValue("四页切换仍保留的草稿");
   if(round>0)timings.push(Date.now()-started);
 }
 await shot("companion-after-20-rounds");
 await page.getByTestId('companion-transcript').hover(); await page.mouse.wheel(0,-400);
 const scroll=page.getByTestId('companion-transcript');
 await expect.poll(()=>scroll.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop)).toBeGreaterThan(200);
 const offset=await scroll.evaluate(element=>element.scrollTop);
 await page.getByRole('tab',{name:'成长',exact:true}).click(); await page.getByRole('tab',{name:'陪伴',exact:true}).click();
 await expect.poll(async()=>Math.abs(await scroll.evaluate(element=>element.scrollTop)-offset)).toBeLessThan(3);
 checks.push('companion-reading-offset-preserved');
 await page.getByRole("tab",{name:"记忆",exact:true}).click();
 await page.getByRole("button",{name:"记下一件事",exact:true}).click();
 await page.getByLabel("个人记忆内容").fill("缓存刷新验收记忆");
 await page.getByRole("button",{name:"保存记忆",exact:true}).click();
 await expect(page.getByText("缓存刷新验收记忆",{exact:true})).toBeVisible();
 await shot("memory-after-write");
 await goto("/pet-growth"); await expect(page).toHaveURL(/section=growth/);
 await expect(page.getByRole("tab",{name:"成长",exact:true})).toHaveAttribute("aria-selected","true");
 await shot("legacy-growth-redirect");
 await goto("/pet-capabilities"); await expect(page.getByText("能力与授权",{exact:true})).toBeVisible();
 await page.getByLabel("查找能力").fill("提醒"); await shot("capability-catalog");
 assert.deepEqual(errors,[]);timings.sort((a,b)=>a-b);
 await writeFile(resolve(out,"report.json"),JSON.stringify({success:true,checks,errors,switches:timings.length,p95_browser_with_automation_ms:timings[Math.floor(timings.length*.95)],scope:"Synthetic browser only. Native phone performance and notifications remain untested."},null,2));
 console.log("PASS workspace preservation, memory refresh, legacy routes and capability catalog");
} catch(error) { await page.screenshot({path:resolve(out,"failure.png")}); await writeFile(resolve(out,"report.json"),JSON.stringify({success:false,errors,failure:String(error)},null,2));throw error; } finally {await browser.close();}
