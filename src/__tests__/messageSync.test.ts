jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
import AsyncStorage from "@react-native-async-storage/async-storage";
import {clearAccountMessageCaches,coalesceRefresh,latestSentMessage,mergeMessages,MessageCache,newestCursor} from "../chat/messageSync";
import type {ChatMessage} from "../data/types";
const m=(id:string,extra:Partial<ChatMessage>={}):ChatMessage=>({id,clientId:id,spaceId:"group",senderId:"owner",actorKind:"human",actorName:"test",kind:"text",text:id,mediaPath:null,mediaDurationSeconds:null,replyToMessageId:null,replyPreview:null,createdAt:"2026-09-11T00:00:00Z",deliveryState:"sent",reactions:{},...extra});

it("read receipts skip pending, failed, uploading and deleted messages until a real ACK exists",()=>{
  const prior=m("server-row");
  const unsent=[m("temporary",{deliveryState:"pending"}),m("failed",{deliveryState:"failed"}),m("image",{deliveryState:"uploading"}),m("deleted",{deletedAt:"now"})];
  expect(latestSentMessage(unsent)).toBeUndefined();
  expect(latestSentMessage([prior,...unsent])).toEqual(prior);
  const acknowledged=m("confirmed-server-id",{clientId:"temporary",createdAt:"2026-09-11T00:00:01Z"});
  expect(latestSentMessage(mergeMessages([prior,unsent[0]],[acknowledged]))).toEqual(acknowledged);
});

it("orders same-time messages by stable ID and does not regress acknowledged sends",()=>{
  expect(mergeMessages([m("b"),m("a")],[m("a",{deliveryState:"pending"})])).toEqual([m("a"),m("b")]);
  expect(newestCursor([m("b"),m("a")])).toEqual({at:"2026-09-11T00:00:00Z",id:"b"});
});
it("removes deleted rows by database ID even when the tombstone has no client ID",()=>{
  expect(mergeMessages([m("one")],[m("one",{senderId:null,clientId:"tombstone",deletedAt:"now"})])).toEqual([]);
});
it("does not replace a newer message edit with a stale fetch",()=>{
  expect(mergeMessages([m("a",{text:"new",updatedAt:"2026-09-12"})],[m("a",{updatedAt:"2026-09-11"})])[0].text).toBe("new");
});
it("uses commit sequence for late transactions even when timestamps move backwards",()=>{
  const laterCommit=m("late",{syncSequence:8,updatedAt:"2026-09-10"});
  expect(newestCursor([laterCommit],{at:"2026-09-12",id:"early",sequence:7})).toEqual({at:"2026-09-10",id:"late",sequence:8});
  expect(mergeMessages([m("a",{text:"old",syncSequence:7,updatedAt:"2026-09-12"})],[m("a",{text:"new",syncSequence:8,updatedAt:"2026-09-10"})])[0].text).toBe("new");
  expect(newestCursor([m("legacy",{updatedAt:"2027-01-01"})],{at:"2026-09-12",id:"early",sequence:7})?.sequence).toBe(7);
});
it("isolates account/conversation caches and fences late writes after revocation",async()=>{
  const a=new MessageCache("one","group"), b=new MessageCache("two","group");
  await a.save({messages:[m("private")],cursor:null,hasOlder:false});
  expect(await b.load()).toBeNull();
  const late=a.save({messages:[m("late")],cursor:null,hasOlder:false});
  await a.clear(); await late;
  await a.save({messages:[m("resurrect")],cursor:null,hasOlder:false});
  expect(await new MessageCache("one","group").load()).toBeNull();
});
it("revocation through a new page waits for older page writes and prevents resurrection",async()=>{
  const values=new Map<string,string>();let release!:()=>void,started!:()=>void;
  const held=new Promise<void>(r=>{release=r;}),began=new Promise<void>(r=>{started=r;});
  const storage={getItem:async(key:string)=>values.get(key)??null,removeItem:async(key:string)=>{values.delete(key);},setItem:async(key:string,value:string)=>{started();await held;values.set(key,value);}};
  const oldPage=new MessageCache("revoke-owner","group",storage),newPage=new MessageCache("revoke-owner","group",storage);
  const write=oldPage.save({messages:[m("protected")],cursor:null,hasOlder:false});await began;
  const clear=newPage.clear();release();await Promise.all([write,clear]);
  await oldPage.save({messages:[m("resurrect")],cursor:null,hasOlder:false});
  expect(await new MessageCache("revoke-owner","group",storage).load()).toBeNull();
});
it("a new login cache survives an earlier logout disk sweep",async()=>{
  const oldPage=new MessageCache("rapid-cache-login","group");
  await oldPage.save({messages:[m("old")],cursor:null,hasOlder:false});
  let release!:()=>void,started!:()=>void;
  const held=new Promise<void>(r=>{release=r;}),began=new Promise<void>(r=>{started=r;});
  const original=AsyncStorage.getAllKeys.bind(AsyncStorage);
  const readKeys=jest.spyOn(AsyncStorage,"getAllKeys").mockImplementationOnce(async()=>{started();await held;return original();});
  const clearing=clearAccountMessageCaches("rapid-cache-login");await began;
  const fresh=new MessageCache("rapid-cache-login","group");
  const saved=fresh.save({messages:[m("fresh")],cursor:null,hasOlder:false});
  release();await Promise.all([clearing,saved]);readKeys.mockRestore();
  expect((await fresh.load())?.messages.map(row=>row.id)).toEqual(["fresh"]);
  expect(await oldPage.load()).toBeNull();
});
it("coalesces bursts and performs a follow-up when an event arrives in flight",async()=>{
  let release!:()=>void, started!:()=>void;
  const held=new Promise<void>((r)=>{release=r;}), began=new Promise<void>((r)=>{started=r;});
  let calls=0;
  const refresh=coalesceRefresh(async()=>{calls++;started();if(calls===1)await held;});
  const first=refresh();await began;
  const rest=Array.from({length:30},()=>refresh());release();
  await Promise.all([first,...rest]);expect(calls).toBe(2);
});
