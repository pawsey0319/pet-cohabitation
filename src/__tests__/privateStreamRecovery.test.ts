const mockFetch=jest.fn(),mockRemove=jest.fn();let mockOwner='owner';
const mockChannels:any[]=[];
jest.mock('expo/fetch',()=>({fetch:(...args:unknown[])=>mockFetch(...args)}));
jest.mock('../lib/supabase',()=>({requireSupabase:()=>({auth:{getSession:async()=>({data:{session:mockOwner?{user:{id:mockOwner},access_token:'synthetic'}:null}})},channel:(name:string)=>{const c:any={name,on:jest.fn((_event,_filter,handler)=>{c.handler=handler;return c;}),subscribe:()=>c};mockChannels.push(c);return c;},removeChannel:mockRemove})}));
import { abortAllPrivateStreams, abortPrivateStream, chatWithStream } from '../pets/streamClient';
const reply={id:'reply',role:'pet',content:'合成回答'};
const encoder=new TextEncoder();
function response(events:unknown[],unfinished=false,signal?:AbortSignal){
 const chunks=events.map(event=>({done:false,value:encoder.encode('data: '+JSON.stringify(event)+'\n\n')}));
 const reader={read:jest.fn(async()=>{if(chunks.length)return chunks.shift();if(!unfinished)return {done:true};return new Promise((_resolve,reject)=>{const abort=()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}));if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});}),cancel:jest.fn(async()=>{}),releaseLock:jest.fn()};
 return {ok:true,status:200,headers:{get:()=> 'text/event-stream'},body:{getReader:()=>reader}};
}
beforeEach(()=>{jest.useFakeTimers();mockOwner='owner';mockFetch.mockReset();mockRemove.mockReset();mockChannels.length=0;});
afterEach(()=>{abortAllPrivateStreams();jest.useRealTimers();});

test('EOF after accepted recovers same request and revision without another POST',async()=>{
 mockFetch.mockResolvedValue(response([{type:'accepted',revision:7,request_id:'request'}]));const recover=jest.fn(async()=>reply),onEvent=jest.fn();
 await expect(chatWithStream('合成问题','request',{onEvent,contextRevision:6},recover)).resolves.toBe(reply);
 expect(mockFetch).toHaveBeenCalledTimes(1);expect(recover).toHaveBeenCalledWith({ownerId:'owner',requestId:'request',revision:7},expect.any(AbortSignal));expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({type:'phase',phase:'confirming'}));expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({type:'done',message:reply}));
});
test('120-second transport deadline switches to bounded recovery rather than re-POSTing',async()=>{
 mockFetch.mockImplementation(async(_url,{signal})=>response([{type:'accepted',revision:1}],true,signal));const recover=jest.fn(async()=>reply);const pending=chatWithStream('问题','request',{},recover);
 await jest.advanceTimersByTimeAsync(120000);await expect(pending).resolves.toBe(reply);expect(recover).toHaveBeenCalledTimes(1);expect(mockFetch).toHaveBeenCalledTimes(1);
});
test.each(['text_model_timeout','companion_context_changed','private_request_stopped','private_request_excluded'])('business SSE error %s is never recovered as a lost connection',async code=>{
 mockFetch.mockResolvedValue(response([{type:'error',error:code}]));const recover=jest.fn();await expect(chatWithStream('问题','request',{},recover)).rejects.toThrow(code);expect(recover).not.toHaveBeenCalled();
});
test.each(['request','all','signal'])('explicit %s cancellation during transport never enters recovery',async how=>{
 const signal=new AbortController();mockFetch.mockImplementation(async(_url,options)=>response([],true,options.signal));const recover=jest.fn();const pending=chatWithStream('问题','request',{signal:signal.signal},recover);const assertion=expect(pending).rejects.toThrow(how==='all'?'account_changed':'private_request_stopped');
 await jest.advanceTimersByTimeAsync(0);if(how==='request')abortPrivateStream('request');else if(how==='all')abortAllPrivateStreams();else signal.abort();await assertion;expect(recover).not.toHaveBeenCalled();
});
test('stop while reconciliation is in flight aborts it and rejects even a late recovered answer',async()=>{
 mockFetch.mockResolvedValue(response([]));let finish!:(value:any)=>void;let recoverySignal!:AbortSignal;const recover=jest.fn((_request,signal)=>{recoverySignal=signal;return new Promise<Record<string,unknown>>(resolve=>{finish=resolve;});});const pending=chatWithStream('问题','request',{contextRevision:0},recover);const assertion=expect(pending).rejects.toThrow('private_request_stopped');await jest.advanceTimersByTimeAsync(0);abortPrivateStream('request');expect(recoverySignal.aborted).toBe(true);finish(reply);await assertion;
});
test('realtime revision invalidation aborts waiting and cannot recover old content',async()=>{
 mockFetch.mockImplementation(async(_url,{signal})=>response([],true,signal));const recover=jest.fn();const pending=chatWithStream('问题','request',{},recover);const assertion=expect(pending).rejects.toThrow('companion_context_changed');await jest.advanceTimersByTimeAsync(0);mockChannels[0].handler({new:{owner_id:'owner',status:'invalidated'}});await assertion;expect(recover).not.toHaveBeenCalled();
});
