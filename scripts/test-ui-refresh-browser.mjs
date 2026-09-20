import assert from "node:assert/strict";
import {chromium,expect} from "@playwright/test";
import {createServer} from "node:http";
import {readFile,stat,mkdir} from "node:fs/promises";
import {resolve,extname,sep} from "node:path";
const root=resolve("test-results/mobile-keyboard-web"),out=resolve("test-results/ui-refresh");
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
  let p=resolve(root,"."+decodeURIComponent(new URL(req.url,"http://localhost").pathname));
  if(p!==root&&!p.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  if(!(await stat(p).catch(()=>null))?.isFile())p=resolve(root,"index.html");
  res.writeHead(200,{"Content-Type":({".html":"text/html",".js":"application/javascript",".png":"image/png"})[extname(p)]??"application/octet-stream"});res.end(await readFile(p));
});
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on("pageerror",e=>errors.push(e.message));
const shot=async(name)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:resolve(out,name+".png")});};
const openSettings=async()=>{await page.goto(base+"/me");await expect(page.getByText("外观与显示",{exact:true})).toBeVisible();};
const openAppearance=async()=>{await openSettings();await page.getByRole("button",{name:"外观与显示 浅色、深色与跟随系统"}).click();};
try{
 await page.goto(base+"/login");await shot("01-login");
 await page.getByRole("button",{name:"进入本地体验",exact:true}).click();await expect(page).toHaveURL(/\/pet/);await shot("02-onboarding");
 await page.evaluate(()=>{
  const owner=JSON.parse(localStorage.getItem("pet-cohabitation-local-profile-v2")).id;
  localStorage.setItem(`pet-cohabitation-local-pet-v2:${owner}`,JSON.stringify({pet:{id:"local-pet",ownerId:owner,name:"芽芽",status:"confirmed",currentAssetId:null,confirmedAt:new Date().toISOString()},messages:[{id:"source1",role:"owner",content:"最近更喜欢喝茶了，想找个安静的地方读书。",createdAt:new Date().toISOString(),conversationKind:"companion"},{id:"reply1",role:"pet",content:"一杯茶、一本书，慢慢待一会儿。你最近在读什么？",createdAt:new Date().toISOString(),conversationKind:"companion"}],assets:[],signals:[],generationDates:[],generationSessions:[],experiences:[],evolutionEvents:[]}));
 });
 await page.reload();await expect(page.getByLabel("异宠私聊输入")).toBeVisible();await shot("03-companion-light");
 await page.getByRole("button",{name:"管理记忆"}).click();await shot("04-memory");await page.getByRole("button",{name:"返回聊天"}).click();
 await openSettings();await shot("05-settings");
 await page.getByRole("button",{name:"聊天背景 推荐背景、上传图片、AI 设计"}).click();
 await page.getByRole("button",{name:"薄雾背景"}).click();await shot("06-background-preview");
 await page.getByRole("button",{name:"应用到全部聊天",exact:true}).click();await expect(page.getByRole("button",{name:"关闭",exact:true})).toHaveCount(0);
 const readSettings=()=>page.evaluate(()=>{const owner=JSON.parse(localStorage.getItem("pet-cohabitation-local-profile-v2")).id;return JSON.parse(localStorage.getItem(`pet-chat-background-v1:${owner}`));});
 assert.equal((await readSettings()).settings.global.presetId,"mist");
 await page.goto(base+"/pet");await page.getByRole("button",{name:"设置陪伴聊天背景"}).click();
 await page.getByRole("button",{name:"暖砂背景"}).click();await page.getByRole("button",{name:"应用到此聊天",exact:true}).click();
 assert.equal((await readSettings()).settings.companion.presetId,"sand");assert.equal((await readSettings()).settings.global.presetId,"mist");
 await page.reload();await page.getByRole("button",{name:"设置陪伴聊天背景"}).click();await expect(page.getByRole("button",{name:"暖砂背景"})).toContainText("✓");
 await page.getByRole("tab",{name:"AI 设计",exact:true}).click();await page.getByLabel("背景设计描述").fill("灰绿色竹林，留白，安静的自然光");await expect(page.getByRole("button",{name:"生成新背景",exact:true})).toBeDisabled();await shot("07-ai-background-demo");
 await page.setViewportSize({width:390,height:480});await page.getByLabel("背景设计描述").fill("灰绿色竹林，保持安静留白");await expect.poll(async()=>{const b=await page.getByLabel("背景设计描述").boundingBox();return !!b&&b.y>=0&&b.y+b.height<=480;}).toBe(true);await page.setViewportSize({width:390,height:844});
 await page.getByRole("button",{name:"关闭",exact:true}).click();
 await openAppearance();await page.getByRole("button",{name:"使用暖夜主题"}).click();await page.getByRole("button",{name:"保存",exact:true}).click();
 await page.goto(base+"/pet");await expect.poll(()=>page.evaluate(()=>document.documentElement.style.colorScheme)).toBe("dark");await shot("08-companion-dark");
 await openAppearance();await page.getByRole("button",{name:"使用跟随系统主题"}).click();await page.getByRole("button",{name:"保存",exact:true}).click();await page.emulateMedia({colorScheme:"light"});await expect.poll(()=>page.evaluate(()=>document.documentElement.style.colorScheme)).toBe("light");await page.emulateMedia({colorScheme:"dark"});await expect.poll(()=>page.evaluate(()=>document.documentElement.style.colorScheme)).toBe("dark");
 await openSettings();await page.getByRole("button",{name:"账号与隐私",exact:true}).click();await expect(page.getByRole("button",{name:"导出我的数据"})).toBeVisible();await shot("09-account-dark");
 await openAppearance();await page.getByRole("button",{name:"使用清浅主题"}).click();await page.getByRole("button",{name:"保存",exact:true}).click();
 await page.goto(base+"/chats");await expect(page.getByLabel("搜索会话")).toBeVisible();await expect(page.getByRole("button",{name:"通知",exact:true})).toHaveCount(0);await shot("10-messages");
 assert.deepEqual(errors,[]);console.log("PASS: theme switching/system mode, settings, global/thread backgrounds, persistence, and honest local AI state; 10 screenshots saved");
}catch(error){console.error("Page errors:",errors);console.error(await page.evaluate(()=>({scheme:document.documentElement.style.colorScheme,media:matchMedia("(prefers-color-scheme: dark)").matches,theme:localStorage.getItem(`pet-cohabitation-theme-v1:${JSON.parse(localStorage.getItem("pet-cohabitation-local-profile-v2")).id}`)})));await shot("failure");throw error;}
finally{await browser.close();await new Promise(done=>server.close(done));}
