import AsyncStorage from "@react-native-async-storage/async-storage";
const mockStorage=new Map<string,string>();
jest.mock("@react-native-async-storage/async-storage",()=>({__esModule:true,default:{getItem:jest.fn(async(key:string)=>mockStorage.get(key)??null),setItem:jest.fn(async(key:string,value:string)=>{mockStorage.set(key,value);}),removeItem:jest.fn(async(key:string)=>{mockStorage.delete(key);})}}));
import {PrivateSendQueue} from "../pets/privateSendQueue";
function deferred<T=void>(){let resolve!:(value:T)=>void;let reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
beforeEach(()=>{mockStorage.clear();jest.clearAllMocks();});

test("persists immutable content before sending and sends a concurrently appended draft in sequence",async()=>{
 const q=new PrivateSendQueue("a"),gate=deferred(),started=deferred();await q.enqueue("one","first");
 const sent:string[]=[];const send=jest.fn(async(row)=>{expect(JSON.parse(mockStorage.get("pet-private-send-queue-v1:a")!)).toEqual(expect.arrayContaining([expect.objectContaining({id:row.id,content:row.content})]));sent.push(row.id);if(row.id==="one"){started.resolve();await gate.promise;}});
 const drain=q.flush(send);await started.promise;await q.enqueue("two","new draft");const concurrent=q.flush(send);expect(sent).toEqual(["one"]);gate.resolve();await Promise.all([drain,concurrent]);expect(sent).toEqual(["one","two"]);expect(q.snapshot()).toEqual([]);
});
test("failed first request blocks later messages and explicit retry reuses its original ID",async()=>{
 const q=new PrivateSendQueue("a");await q.enqueue("one","first");await q.enqueue("two","second");const send=jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
 await q.flush(send);await q.flush(send);expect(send).toHaveBeenCalledTimes(1);expect(q.snapshot()[0]).toMatchObject({id:"one",status:"failed"});await expect(q.enqueue("one","replacement")).rejects.toThrow("不能替换内容");
 await q.retry("one");await q.flush(send);expect(send.mock.calls.map(([r])=>r.id)).toEqual(["one","one","two"]);
});
test("process restart recovers sending requests and keeps owner caches isolated",async()=>{
 mockStorage.set("pet-private-send-queue-v1:a",JSON.stringify([{id:"old",content:"kept",status:"sending"}]));const recovered=new PrivateSendQueue("a");await recovered.load();expect(recovered.snapshot()).toEqual([{id:"old",content:"kept",status:"queued"}]);const other=new PrivateSendQueue("b");await other.load();expect(other.snapshot()).toEqual([]);
});
test("QueuePaused retains a recoverable queued request without automatic retry spinning",async()=>{
 const q=new PrivateSendQueue("a");await q.enqueue("one","first");const error=Object.assign(new Error("left page"),{name:"QueuePaused"});const old=jest.fn().mockRejectedValue(error);await Promise.all([q.flush(old),q.flush(old)]);expect(old).toHaveBeenCalledTimes(1);expect(q.snapshot()[0].status).toBe("queued");const fresh=jest.fn().mockResolvedValue(undefined);await q.flush(fresh);expect(fresh).toHaveBeenCalledWith(expect.objectContaining({id:"one"}),expect.any(AbortSignal));
});
test("new page sender takes over when old in-flight sender pauses",async()=>{
 const q=new PrivateSendQueue("a"),gate=deferred(),started=deferred();await q.enqueue("one","first");const old=jest.fn(async()=>{started.resolve();await gate.promise;throw Object.assign(new Error("pause"),{name:"QueuePaused"});});const drain=q.flush(old);await started.promise;const fresh=jest.fn().mockResolvedValue(undefined);const resumed=q.flush(fresh);gate.resolve();await Promise.all([drain,resumed]);expect(fresh).toHaveBeenCalledTimes(1);expect(q.snapshot()).toEqual([]);
});
test("logout while persistence is pending prevents network send and clears late writes",async()=>{
 const q=new PrivateSendQueue("a");await q.enqueue("one","first");const write=deferred(),started=deferred();jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async(key,value)=>{started.resolve();await write.promise;mockStorage.set(key,value);});const send=jest.fn();const drain=q.flush(send);await started.promise;const clear=q.clear();write.resolve();await Promise.all([clear,drain]);expect(send).not.toHaveBeenCalled();expect(mockStorage.has("pet-private-send-queue-v1:a")).toBe(false);await expect(q.enqueue("two","late")).rejects.toThrow("账号已退出");
});
test("logout during network request prevents late response and queued successors from resurrecting",async()=>{
 const q=new PrivateSendQueue("a"),gate=deferred(),started=deferred();await q.enqueue("one","first");await q.enqueue("two","second");const send=jest.fn(async()=>{started.resolve();await gate.promise;});const drain=q.flush(send);await started.promise;await q.clear();gate.resolve();await drain;expect(send).toHaveBeenCalledTimes(1);expect(q.snapshot()).toEqual([]);expect(mockStorage.has("pet-private-send-queue-v1:a")).toBe(false);
});
test("storage failure cannot dispatch an unpersisted message",async()=>{
 const q=new PrivateSendQueue("a");await q.enqueue("one","first");jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("disk full"));const send=jest.fn();await expect(q.flush(send)).rejects.toThrow("disk full");expect(send).not.toHaveBeenCalled();expect(q.snapshot()[0].status).toBe("failed");await q.retry("one");await q.flush(send);expect(send).toHaveBeenCalledTimes(1);
});

test("image request persists one fixed attachment and recovers uploaded reference after restart",async()=>{
 const q=new PrivateSendQueue("a"),attachment={uploadId:"image-a",uri:"file:///stable.jpg"};await q.enqueue("image-request","look",attachment);
 await expect(q.enqueue("image-request","look",{...attachment,uploadId:"image-b"})).rejects.toThrow("不能替换");
 await expect(q.enqueue("image-request","look")).rejects.toThrow("不能替换");
 expect(await q.recordUploaded("image-request",{id:"image-a",version:1,state:"active"})).toBe(true);
 const restored=new PrivateSendQueue("a");await restored.load();expect(restored.snapshot()[0].attachment).toMatchObject({uploadId:"image-a",asset:{id:"image-a",version:1}});
 await expect(q.recordUploaded("image-request",{id:"image-a",version:2,state:"active"})).rejects.toThrow("不能替换");
});

test("stop during image upload aborts continuation and does not send a late message",async()=>{
 const q=new PrivateSendQueue("a"),started=deferred(),upload=deferred(),network=jest.fn();await q.enqueue("image-request","look",{uploadId:"image-a",uri:"file:///stable.jpg"});
 const drain=q.flush(async(_row,signal)=>{started.resolve();await upload.promise;if(signal.aborted)throw new Error("stopped");network();});
 await started.promise;await q.remove("image-request");upload.resolve();await drain;expect(network).not.toHaveBeenCalled();expect(q.snapshot()).toHaveLength(0);
});

test("corrupted persisted image never silently retries as a text-only message",async()=>{
 mockStorage.set("pet-private-send-queue-v1:a",JSON.stringify([{id:"request",content:"look",attachment:{asset:{id:"bad"}},status:"sending"}]));const q=new PrivateSendQueue("a");await q.load();await expect(q.retry("request")).rejects.toThrow("图片草稿");const send=jest.fn();await q.flush(send);expect(send).not.toHaveBeenCalled();
});

test("a late authoritative reply removes a failed head and unblocks the next question without resending it",async()=>{
 const q=new PrivateSendQueue("a");await q.enqueue("one","first");await q.enqueue("two","second");const send=jest.fn().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValue(undefined);
 await q.flush(send);await q.acknowledgeCompleted(["one"]);await q.flush(send);expect(send.mock.calls.map(([row])=>row.id)).toEqual(["one","two"]);expect(q.snapshot()).toEqual([]);expect(JSON.parse(mockStorage.get("pet-private-send-queue-v1:a")!)).toEqual([]);
});
test("a reply arriving during recovery aborts local waiting and continues the queue",async()=>{
 const q=new PrivateSendQueue("a"),started=deferred();await q.enqueue("one","first");await q.enqueue("two","second");let signal:AbortSignal|undefined;
 const send=jest.fn(async(row,activeSignal:AbortSignal)=>{if(row.id!=="one")return;signal=activeSignal;started.resolve();await new Promise((_resolve,reject)=>activeSignal.addEventListener("abort",()=>reject(new Error("local wait finished")),{once:true}));});
 const drain=q.flush(send);await started.promise;await q.acknowledgeCompleted(["one"]);await drain;expect(signal?.aborted).toBe(true);expect(send.mock.calls.map(([row])=>row.id)).toEqual(["one","two"]);expect(q.snapshot()).toEqual([]);
});
test("late completion never removes another request or another owner's queue",async()=>{
 const q=new PrivateSendQueue("a"),other=new PrivateSendQueue("b");await q.enqueue("one","first");await q.enqueue("two","second");await other.enqueue("one","private to b");await q.acknowledgeCompleted(["one"]);await q.acknowledgeCompleted(["one"]);expect(q.snapshot().map(row=>row.id)).toEqual(["two"]);expect(other.snapshot()).toHaveLength(1);await q.clear();await expect(q.acknowledgeCompleted(["two"])).rejects.toThrow("账号已退出");
});
