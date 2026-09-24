jest.mock("@react-native-async-storage/async-storage",()=>require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
import {applyReadState,clearReadState,flushReadState,markLocallyRead,restoreReadState} from "../chat/readState";
import type {ChatMessage,ChatSpace} from "../data/types";
const space=(latest=10,unread=4):ChatSpace=>({id:"group",name:"群",kind:"friend_circle",memberCount:2,maxMembers:20,unreadCount:unread,latestSequence:latest,lastReadSequence:6});
const message=(seq=10):ChatMessage=>({id:`m${seq}`,clientId:`m${seq}`,spaceId:"group",senderId:"friend",actorKind:"human",actorName:"朋友",kind:"text",text:"test",createdAt:"2026-09-20T00:00:00Z",spaceSequence:seq,mediaPath:null,mediaDurationSeconds:null,replyToMessageId:null,replyPreview:null,deliveryState:"sent",reactions:{}});
beforeEach(async()=>{await clearReadState("alice");await clearReadState("bob");});
test("late list responses cannot restore an already visible unread badge",()=>{
  markLocallyRead("alice","group",message());
  expect(applyReadState("alice",[space()])[0].unreadCount).toBe(0);
  expect(applyReadState("bob",[space()])[0].unreadCount).toBe(4);
  expect(applyReadState("alice",[space(11,5)])[0].unreadCount).toBeGreaterThan(0);
});
test("network failure remains retryable and consumes authoritative receipt",async()=>{
  markLocallyRead("alice","group",message());
  await flushReadState("alice",async()=>{throw new Error("offline");});
  const send=jest.fn(async()=>({spaceId:"group",readSequence:10,latestSequence:11,unreadCount:1}));
  await flushReadState("alice",send);
  expect(send).toHaveBeenCalledWith("group","m10");
  expect(applyReadState("alice",[space(11,5)])[0].unreadCount).toBe(1);
});
test("a newer list count after deletion or muting wins over an older read receipt",async()=>{
  markLocallyRead("alice","group",message());
  await flushReadState("alice",async()=>({spaceId:"group",readSequence:10,latestSequence:12,unreadCount:2}));
  expect(applyReadState("alice",[{...space(12,1),lastReadSequence:10}])[0].unreadCount).toBe(1);
  expect(applyReadState("alice",[{...space(12,0),lastReadSequence:10}])[0].unreadCount).toBe(0);
});
test("an old receipt cannot clear a newer pending read",async()=>{
  markLocallyRead("alice","group",message());
  let finish!:(v:any)=>void;
  const first=new Promise<any>(resolve=>{finish=resolve;});let calls=0;
  const work=flushReadState("alice",async()=>++calls===1?first:{spaceId:"group",readSequence:12,latestSequence:12,unreadCount:0});
  markLocallyRead("alice","group",message(12));
  finish({spaceId:"group",readSequence:10,latestSequence:12,unreadCount:2});await work;
  expect(calls).toBe(2);expect(applyReadState("alice",[space(12,6)])[0].unreadCount).toBe(0);
});
test("logout fences late acknowledgements and cached restoration",async()=>{
  markLocallyRead("alice","group",message());let finish!:(v:any)=>void;
  const work=flushReadState("alice",()=>new Promise(resolve=>{finish=resolve;}));
  await clearReadState("alice");finish({spaceId:"group",readSequence:10,latestSequence:10,unreadCount:0});await work;
  await restoreReadState("alice");expect(applyReadState("alice",[space()])[0].unreadCount).toBe(4);
});
