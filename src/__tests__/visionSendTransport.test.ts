import { createPetRepository } from "../data/petRepository";
import { chatWithStream } from "../pets/streamClient";
import { fetch as expoFetch } from "expo/fetch";
jest.mock("@react-native-async-storage/async-storage",()=>require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("expo/fetch",()=>({fetch:jest.fn()}));
const mockInvoke=jest.fn(),mockRemoveChannel=jest.fn();
jest.mock("../lib/supabase",()=>({isLocalDemoMode:false,requireSupabase:()=>({auth:{getSession:async()=>({data:{session:{user:{id:"owner"},access_token:"test-session"}}})},functions:{invoke:mockInvoke},channel:()=>{const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:mockRemoveChannel})}));
const repository=createPetRepository({id:"owner",email:"owner@example.test",nickname:"主人",isAdmin:false});
const image={imageAssetId:"11111111-1111-4111-8111-111111111111",imageAssetVersion:3};
beforeEach(()=>{jest.clearAllMocks();});
test("image with an event callback still sends a single nonstream request containing both text and immutable image reference",async()=>{
 mockInvoke.mockResolvedValue({data:{id:"reply",role:"pet",content:"图片回答",created_at:"2026-09-11T00:00:00Z",agent_request_id:"must-not-execute"},error:null});
 await repository.chat("问题与图片一起提交","fixed-request","companion",{...image,onEvent:jest.fn()});
 expect(expoFetch).not.toHaveBeenCalled();expect(mockInvoke).toHaveBeenCalledTimes(1);expect(mockInvoke.mock.calls[0][0]).toBe("pet-chat");expect(mockInvoke.mock.calls[0][1].body).toEqual({content:"问题与图片一起提交",request_id:"fixed-request",mode:"companion",image_asset_id:image.imageAssetId,image_asset_version:3});
});
test("the stream transport cannot silently drop an explicitly supplied image",async()=>{
 jest.mocked(expoFetch).mockResolvedValue({ok:true,body:{getReader:()=>({read:async()=>({value:new TextEncoder().encode('data: {"type":"done","message":{"id":"reply"}}\n'),done:false}),cancel:async()=>undefined,releaseLock:()=>undefined})},headers:{get:()=>"text/event-stream"}} as any);
 await expect(chatWithStream("同一个图文请求","stream-request",image)).resolves.toEqual({id:"reply"});
 const body=JSON.parse(jest.mocked(expoFetch).mock.calls[0][1]!.body as string);expect(body).toMatchObject({content:"同一个图文请求",request_id:"stream-request",image_asset_id:image.imageAssetId,image_asset_version:3});
});
test("incomplete references and cancelled sends never reach either transport",async()=>{
 const signal=AbortSignal.abort();await expect(repository.chat("问题","cancelled","companion",{...image,signal})).rejects.toThrow("已停止");
 await expect(repository.chat("问题","incomplete","companion",{imageAssetVersion:1})).rejects.toThrow("图片请求不完整");
 await expect(chatWithStream("问题","incomplete-stream",{imageAssetId:image.imageAssetId})).rejects.toThrow("vision_input_invalid");expect(mockInvoke).not.toHaveBeenCalled();expect(expoFetch).not.toHaveBeenCalled();
});
