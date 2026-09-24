jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../lib/supabase", () => ({ isLocalDemoMode: true }));
import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildPreferenceViews, extractLocalPreferences, scorePreference, selectPreferences, validatePreferenceCandidates, type MemoryEvidence, type PreferenceCandidate } from "../../supabase/functions/_shared/preferenceMemory";
import { createPetRepository } from "../data/petRepository";
import { buildPrivateCompanionMessages } from "../../supabase/functions/_shared/privateCompanion";
import { privateContinuation } from "../pets/companion";

const now=Date.parse("2026-09-07T12:00:00Z");
const evidence=(id:string,object:string,at:string,extra:Partial<MemoryEvidence>={}):MemoryEvidence=>({id,object,topic:"drink",context:"global",polarity:"positive",temporal:"current",strength:.6,quote:`我喜欢${object}`,preferredOver:[],operation:"observe",state:"active",origin:"conversation",sourceMessageId:id,manualMemoryId:null,occurredAt:at,...extra});
beforeEach(async()=>{await AsyncStorage.clear();});

test("weights combine age, capped independent UTC days, and expression strength",()=>{
  const rows=Array.from({length:10},(_,i)=>evidence(`${i}`,"咖啡","2026-09-07T08:00:00Z"));
  const [view]=buildPreferenceViews(rows,[],now);
  expect(view.frequencyDays).toBe(1);
  expect(view.score).toBeCloseTo(.5*Math.pow(2,-(4/24)/30)+.3/5+.2*.6,5);
  expect(scorePreference({...view,frequencyDays:99},now).score).toBe(scorePreference({...view,frequencyDays:5},now).score);
  const [manual]=buildPreferenceViews([evidence("m","茶","2026-09-07T08:00:00Z",{origin:"manual",sourceMessageId:null})],[],now);
  expect(manual.frequencyDays).toBe(0);
  const [offsets]=buildPreferenceViews([evidence("utc","茶","2026-09-06T17:00:00Z"),evidence("offset","茶","2026-09-07T01:00:00+08:00")],[],now);
  expect(offsets.frequencyDays).toBe(1);
});

test("explicit comparison outranks old frequency while preserving both histories",()=>{
  const rows=Array.from({length:5},(_,i)=>evidence(`${i}`,"咖啡",`2026-09-0${i+1}T08:00:00Z`));
  rows.push(evidence("tea","茶","2026-09-07T08:00:00Z",{strength:1,preferredOver:["咖啡"]}));
  const views=buildPreferenceViews(rows,[],now);
  expect(views).toHaveLength(2);
  expect(selectPreferences(views,"我今天喝什么")[0].object).toBe("茶");
});

test("negation beats all frequency and importance; a later explicit positive restores preference",()=>{
  const rows=Array.from({length:5},(_,i)=>evidence(`${i}`,"咖啡",`2026-09-0${i+1}T08:00:00Z`));
  rows.push(evidence("no","咖啡","2026-09-06T08:00:00Z",{polarity:"negative"}));
  const [negative]=buildPreferenceViews(rows,["咖啡|global"],now);
  expect(negative.status).toBe("not_recommended"); expect(negative.hadPositive).toBe(true);
  rows.push(evidence("again","咖啡","2026-09-07T08:00:00Z"));
  expect(buildPreferenceViews(rows,[],now)[0].status).toBe("current");
});

test("a current explicit stronger preference can lead without a named comparison object",()=>{
  const rows=Array.from({length:5},(_,i)=>evidence(`${i}`,"咖啡",`2026-09-0${i+1}T08:00:00Z`));
  rows.push(evidence("tea","茶","2026-09-07T08:00:00Z",{strength:1,quote:"我现在更喜欢茶"}));
  expect(selectPreferences(buildPreferenceViews(rows,[],now),"今天喝什么")[0].object).toBe("茶");
});

test("night-only restrictions are not applied to daytime or unrelated questions",()=>{
  const views=buildPreferenceViews([evidence("global","咖啡","2026-09-05T08:00:00Z"),evidence("night","咖啡","2026-09-06T08:00:00Z",{context:"晚上",polarity:"negative"})],[],now);
  expect(selectPreferences(views,"早上喝什么").map((v)=>v.context)).toEqual(["global"]);
  expect(selectPreferences(views,"晚上喝什么").some((v)=>v.status==="not_recommended")).toBe(true);
  expect(selectPreferences(views,"帮我看看面试准备")).toEqual([]);
});

test.each(["朋友喜欢茶","假如我喜欢茶","我说的是‘我喜欢茶’这句话","我开玩笑说喜欢茶","我喜欢茶吗？","如果我喜欢茶，你会怎么说？"])("does not infer a positive preference from %s",(content)=>{
  expect(extractLocalPreferences(content).filter((v)=>v.polarity==="positive")).toEqual([]);
});
test("extracts explicit changes, negation, scoped preferences and corrections with source quotes",()=>{
  const changed=extractLocalPreferences("我以前喜欢咖啡，现在更喜欢茶");
  expect(changed.map((v)=>[v.object,v.temporal])).toEqual([["咖啡","past"],["茶","current"]]);
  expect(changed[1].preferredOver).toEqual(["咖啡"]);
  expect(extractLocalPreferences("我不喜欢茶")[0].polarity).toBe("negative");
  expect(extractLocalPreferences("我晚上不喝咖啡")[0].context).toBe("晚上");
  expect(extractLocalPreferences("你记错了，我从没喜欢过咖啡")[0].operation).toBe("retract");
});
test("validates exact evidence and rejects hallucinated objects and negated positive extraction",()=>{
  const candidate:PreferenceCandidate={object:"茶",topic:"drink",context:"global",polarity:"positive",temporal:"current",strength:.6,quote:"我不喜欢茶",preferredOver:[],operation:"observe"};
  expect(validatePreferenceCandidates("我不喜欢茶",[candidate])).toEqual([]);
  expect(validatePreferenceCandidates("我喜欢咖啡",[{...candidate,quote:"我喜欢茶"}])).toEqual([]);
});

test("a shortened model quote cannot discard hypothetical, attributed or question context",()=>{
  const candidate:PreferenceCandidate={object:"茶",topic:"drink",context:"global",polarity:"positive",temporal:"current",strength:.6,quote:"我喜欢茶",preferredOver:[],operation:"observe"};
  for(const source of ["我喜欢茶？","假如我喜欢茶，会怎样？","朋友说我喜欢茶","他说：‘我喜欢茶’"]){
    expect(validatePreferenceCandidates(source,[candidate])).toEqual([]);
  }
});

test("model polarity and applicable context must have support in the original statement",()=>{
  const candidate:PreferenceCandidate={object:"茶",topic:"drink",context:"global",polarity:"positive",temporal:"current",strength:.6,quote:"我喜欢茶",preferredOver:[],operation:"observe"};
  expect(validatePreferenceCandidates("我喜欢茶",[{...candidate,polarity:"negative"}])).toEqual([]);
  expect(validatePreferenceCandidates("我喜欢茶",[{...candidate,context:"晚上"}])).toEqual([]);
  expect(validatePreferenceCandidates("我不太喜欢茶",[{...candidate,quote:"我不太喜欢茶"}])).toEqual([]);
});

test("local concurrent requests deduplicate messages and evidence, changes keep the current topic",async()=>{
  const repo=createPetRepository({id:"alice",email:"a@example.test",nickname:"Alice"}); await repo.createPet("芽芽");
  await Promise.all([repo.chat("我喜欢咖啡","same-id"),repo.chat("我喜欢咖啡","same-id")]);
  expect(await repo.listPrivateMessages()).toHaveLength(2);
  expect((await repo.listMemoryEvidence("咖啡|global")).items).toHaveLength(1);
  await repo.chat("我今天准备面试","interview");
  await repo.chat("我已经不喜欢咖啡了","negative");
  let context=await repo.getCompanionContext();
  expect(context.preferences?.[0].status).toBe("not_recommended"); expect(context.contextStartedAt).toBeNull();
  await repo.updatePreference({key:"咖啡|global",action:"positive"});
  expect((await repo.getCompanionContext()).preferences?.[0].status).toBe("current");
  await repo.updatePreference({key:"咖啡|global",action:"forget"});
  context=await repo.getCompanionContext();
  expect(context.preferences).toEqual([]);
  const messages=await repo.listPrivateMessages();
  const interview=messages.find((m)=>m.content==="我今天准备面试")!;
  expect(context.excludedMessageIds).not.toContain(interview.id);
  expect(context.excludedMessageIds).toContain(messages[0].id);
  await repo.chat("我现在喜欢茶","fresh");
  expect((await repo.getCompanionContext()).preferences?.[0].object).toBe("茶");
});

test("correction invalidates false history and linked replies; source messages remain readable",async()=>{
  const repo=createPetRepository({id:"alice",email:"a@example.test",nickname:"Alice"}); await repo.createPet("芽芽");
  await repo.chat("我喜欢咖啡"); const initial=await repo.listPrivateMessages();
  await repo.updatePreference({key:"咖啡|global",action:"retract"});
  const context=await repo.getCompanionContext();
  expect(context.preferences).toEqual([]);
  expect(context.excludedMessageIds).toEqual(expect.arrayContaining(initial.map((m)=>m.id)));
  expect((await repo.listMemoryEvidence("咖啡|global")).items[0].state).toBe("retracted");
  expect(await repo.listPrivateMessages()).toHaveLength(2);
});

test("prompt omits excluded sources, keeps unrelated dialogue and labels preference status",()=>{
  const preference=buildPreferenceViews([evidence("coffee","咖啡","2026-09-07T08:00:00Z",{polarity:"negative"})],[],now);
  const payload=buildPrivateCompanionMessages({petName:"芽芽",personality:"好奇",styles:[],memories:[],recalledMessages:[],contextStartedAt:null,preferences:preference,excludedMessageIds:["forgotten"],messages:[{id:"forgotten",role:"owner",content:"SECRET OLD FACT",created_at:"2026-09-06T08:00:00Z"},{id:"current",role:"owner",content:"今天喝什么",created_at:"2026-09-07T08:00:00Z"}]});
  expect(JSON.stringify(payload)).not.toContain("SECRET OLD FACT");
  expect(payload[1].content).toContain("not_recommended");
  expect(payload.at(-1)?.content).toContain("今天喝什么");
});
test("reunion does not quote a preference superseded by a later explicit state",()=>{
  const messages=[{id:"old",role:"owner" as const,content:"我喜欢咖啡",createdAt:"2026-09-01T08:00:00Z"}];
  const views=buildPreferenceViews([evidence("new","咖啡","2026-09-07T08:00:00Z",{polarity:"negative"})],[],now);
  expect(privateContinuation(messages,null,now,views)).toBeNull();
});
