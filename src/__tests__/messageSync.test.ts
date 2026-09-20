jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
import {coalesceRefresh,latestSentMessage,mergeMessages,MessageCache,newestCursor} from "../chat/messageSync";
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
it("isolates account/conversation caches and fences late writes after revocation",async()=>{
  const a=new MessageCache("one","group"), b=new MessageCache("two","group");
  await a.save({messages:[m("private")],cursor:null,hasOlder:false});
  expect(await b.load()).toBeNull();
  const late=a.save({messages:[m("late")],cursor:null,hasOlder:false});
  await a.clear(); await late;
  await a.save({messages:[m("resurrect")],cursor:null,hasOlder:false});
  expect(await new MessageCache("one","group").load()).toBeNull();
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
