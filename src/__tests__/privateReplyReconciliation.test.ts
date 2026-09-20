const mockQueries:{table:string;filters:Record<string,unknown>;signal?:AbortSignal}[]=[];
let mockOwner='owner',mockRevision=4,mockStreamStatus='streaming',mockCancelled=false,mockExcluded=false,mockComplete=true,mockStatus='thinking',mockError='text_model_timeout',mockReads=0;
let mockReplyGate:(()=>Promise<void>)|null=null,mockHangTable:string|null=null,mockStartedAt:string|null=null,mockMode='companion';
const mockInvoke=jest.fn();
function mockQuery(table:string){const query:any={table,filters:{}};const builder:any={select:()=>builder,eq:(key:string,value:unknown)=>{query.filters[key]=value;return builder;},in:(key:string,value:unknown)=>{query.filters[key]=value;return builder;},abortSignal:(signal:AbortSignal)=>{query.signal=signal;return builder;},maybeSingle:()=>builder,then:(yes:any,no:any)=>execute().then(yes,no)};
 async function execute(){mockQueries.push(query);if(table===mockHangTable)return new Promise(()=>{});if(table==='pet_private_requests'){mockReads++;return {data:{pet_id:'pet',owner_message_id:'source',reply_message_id:mockComplete?'reply':null}};}if(table==='pet_private_threads'&&query.filters.id==='source')return {data:{id:'source',created_at:'2026-09-14T10:00:00Z',conversation_kind:mockMode,reply_status:mockStatus,reply_error_code:mockError}};if(table==='pet_private_threads'){await mockReplyGate?.();return {data:{id:'reply',role:'pet',in_reply_to_id:'source',conversation_kind:mockMode,content:'合成回答',context_message_ids:['context'],agent_request_id:'existing-action'}};}if(table==='pet_companion_states')return {data:{revision:mockRevision,context_started_at:mockStartedAt}};if(table==='pet_private_streams')return {data:{status:mockStreamStatus,revision:4}};if(table==='pet_private_cancellations')return {data:mockCancelled?{request_id:'request'}:null};if(table==='pet_private_context_exclusions')return {data:mockExcluded?[{message_id:'source'}]:[]};throw new Error('Unexpected table '+table);}
 return builder;
}
jest.mock('../lib/supabase',()=>({isLocalDemoMode:false,requireSupabase:()=>({auth:{getSession:async()=>({data:{session:{user:{id:mockOwner}}}})},from:mockQuery,functions:{invoke:mockInvoke}})}));
jest.mock('@react-native-async-storage/async-storage',()=>require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { PRIVATE_REPLY_RECOVERY_MS, createPetRepository, privateReplyErrorMessage, recoverPrivateReply } from '../data/petRepository';
import { abortAllPrivateStreams, abortPrivateStream } from '../pets/streamClient';
const request={ownerId:'owner',requestId:'request',revision:4};
beforeEach(()=>{jest.useFakeTimers();mockQueries.length=0;mockOwner='owner';mockRevision=4;mockStreamStatus='streaming';mockCancelled=false;mockExcluded=false;mockComplete=true;mockStatus='thinking';mockError='text_model_timeout';mockReads=0;mockReplyGate=null;mockHangTable=null;mockStartedAt=null;mockMode='companion';mockInvoke.mockReset();});
afterEach(()=>{abortAllPrivateStreams();jest.useRealTimers();});

test('already committed response is read with owner/request/reply fences and no business POST',async()=>{
 await expect(recoverPrivateReply(request,new AbortController().signal)).resolves.toMatchObject({id:'reply',content:'合成回答'});expect(mockInvoke).not.toHaveBeenCalled();expect(mockQueries.every(q=>q.filters.owner_id==='owner'&&q.signal instanceof AbortSignal)).toBe(true);expect(mockQueries.find(q=>q.table==='pet_private_requests')?.filters).toMatchObject({client_request_id:'request'});expect(mockQueries.filter(q=>q.table==='pet_private_context_exclusions').at(-1)?.filters.message_id).toEqual(['source','reply','context']);
});
test('running request can complete during read-only bounded polling',async()=>{
 mockComplete=false;const pending=recoverPrivateReply(request,new AbortController().signal);await jest.advanceTimersByTimeAsync(0);expect(mockReads).toBe(1);mockComplete=true;await jest.advanceTimersByTimeAsync(2000);await expect(pending).resolves.toMatchObject({id:'reply'});expect(mockReads).toBe(2);expect(mockInvoke).not.toHaveBeenCalled();
});
test('an uncooperative hanging read is cut off at total recovery deadline and receives abort',async()=>{
 mockHangTable='pet_private_requests';const pending=recoverPrivateReply(request,new AbortController().signal);const assertion=expect(pending).rejects.toThrow('private_reply_confirmation_pending');await jest.advanceTimersByTimeAsync(PRIVATE_REPLY_RECOVERY_MS);await assertion;expect(mockQueries[0].signal?.aborted).toBe(true);expect(mockInvoke).not.toHaveBeenCalled();
});
test('still-running request stops polling after 30 seconds',async()=>{
 mockComplete=false;const pending=recoverPrivateReply(request,new AbortController().signal);const assertion=expect(pending).rejects.toThrow('private_reply_confirmation_pending');await jest.advanceTimersByTimeAsync(PRIVATE_REPLY_RECOVERY_MS);await assertion;const reads=mockReads;await jest.advanceTimersByTimeAsync(6000);expect(mockReads).toBe(reads);expect(reads).toBeLessThanOrEqual(15);
});
test.each(['revision','invalidated','cancelled','excluded','new_topic','account'])('%s blocks recovery of an existing reply',async mode=>{
 if(mode==='revision')mockRevision=5;if(mode==='invalidated')mockStreamStatus='invalidated';if(mode==='cancelled')mockCancelled=true;if(mode==='excluded')mockExcluded=true;if(mode==='new_topic')mockStartedAt='2026-09-14T11:00:00Z';if(mode==='account')mockOwner='other';await expect(recoverPrivateReply(request,new AbortController().signal)).rejects.toThrow(/context_changed|stopped|excluded|topic_changed|account_changed/);expect(mockInvoke).not.toHaveBeenCalled();
});
test.each(['revision','excluded','cancelled','account'])('%s changing during reply download is fenced before returning content',async mode=>{
 mockReplyGate=async()=>{if(mode==='revision')mockRevision=5;if(mode==='excluded')mockExcluded=true;if(mode==='cancelled')mockCancelled=true;if(mode==='account')mockOwner='other';};await expect(recoverPrivateReply(request,new AbortController().signal)).rejects.toThrow(/context_changed|excluded|stopped|account_changed/);
});
test('local stop immediately ends an unresponsive recovery read',async()=>{
 mockHangTable='pet_private_requests';const controller=new AbortController();const pending=recoverPrivateReply(request,controller.signal);const assertion=expect(pending).rejects.toThrow('private_request_stopped');await jest.advanceTimersByTimeAsync(0);controller.abort();await assertion;expect(mockQueries[0].signal?.aborted).toBe(true);
});
test('server model failure remains specific and does not poll or repost',async()=>{
 mockComplete=false;mockStatus='failed';await expect(recoverPrivateReply(request,new AbortController().signal)).rejects.toThrow('text_model_timeout');expect(mockReads).toBe(1);expect(privateReplyErrorMessage('text_model_timeout')).toContain('模型思考超时');expect(privateReplyErrorMessage('text_model_network_error')).toContain('无法连接');expect(mockInvoke).not.toHaveBeenCalled();
});

const repository=createPetRepository({id:'owner',email:'synthetic@example.test',nickname:'合成',isAdmin:false});
test('steward lost HTTP response recovers its original request without redispatching an existing action',async()=>{
 mockMode='steward';mockInvoke.mockResolvedValue({data:null,error:new TypeError('network lost')});
 await expect(repository.chat('合成管家问题','original-request','steward')).resolves.toMatchObject({id:'reply',conversationKind:'steward',agentRequestId:'existing-action'});
 expect(mockInvoke).toHaveBeenCalledTimes(1);expect(mockInvoke.mock.calls[0][0]).toBe('pet-chat');expect(mockInvoke.mock.calls[0][1].body.request_id).toBe('original-request');
 expect(mockQueries.find(q=>q.table==='pet_private_requests')?.filters.client_request_id).toBe('original-request');expect(mockQueries.find(q=>q.filters.id==='reply')?.filters.conversation_kind).toBe('steward');
 expect(mockQueries.some(q=>q.table==='pet_companion_states'||q.table==='pet_private_streams')).toBe(false);
});
test('steward request still running after lost response may finish within the same recovery window',async()=>{
 mockMode='steward';mockComplete=false;mockInvoke.mockRejectedValue(new TypeError('network lost'));
 const pending=repository.chat('问题','request','steward');await jest.advanceTimersByTimeAsync(0);mockComplete=true;await jest.advanceTimersByTimeAsync(2000);await expect(pending).resolves.toMatchObject({id:'reply'});expect(mockInvoke).toHaveBeenCalledTimes(1);
});
test.each(['text_model_timeout','private_request_running','companion_context_changed'])('steward explicit %s business failure is not read-recovered',async code=>{
 mockMode='steward';mockInvoke.mockResolvedValue({data:null,error:{context:{status:504,json:async()=>({error:code})}}});
 await expect(repository.chat('问题','same-id','steward')).rejects.toThrow(privateReplyErrorMessage(code));expect(mockQueries).toHaveLength(0);expect(mockInvoke).toHaveBeenCalledTimes(1);
});
test('steward explicit retry keeps the original request ID after a model timeout',async()=>{
 mockMode='steward';mockInvoke.mockResolvedValueOnce({data:null,error:{context:{json:async()=>({error:'text_model_timeout'})}}}).mockResolvedValueOnce({data:{id:'reply',role:'pet',content:'合成回答'},error:null});
 await expect(repository.chat('问题','same-id','steward')).rejects.toThrow('模型思考超时');await repository.chat('问题','same-id','steward');expect(mockInvoke.mock.calls.map(call=>call[1].body.request_id)).toEqual(['same-id','same-id']);expect(mockQueries).toHaveLength(0);
});
test.each(['request','all','signal'])('steward explicit %s stop rejects an uncooperative invoke without entering recovery',async how=>{
 mockMode='steward';let finish!:(value:any)=>void;mockInvoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const controller=new AbortController();
 const pending=repository.chat('问题','request','steward',{signal:controller.signal});const assertion=expect(pending).rejects.toThrow(how==='all'?'账号已切换':'已停止');await jest.advanceTimersByTimeAsync(0);
 if(how==='request')abortPrivateStream('request');else if(how==='all')abortAllPrivateStreams();else controller.abort();await assertion;
 finish({error:new TypeError('lost'),data:null});await jest.advanceTimersByTimeAsync(0);expect(mockQueries).toHaveLength(0);expect(mockInvoke).toHaveBeenCalledTimes(1);
});
test('steward recovery has a hard deadline on its actual read and is locally cancellable',async()=>{
 mockMode='steward';mockHangTable='pet_private_requests';mockInvoke.mockResolvedValue({error:new TypeError('lost')});
 const pending=repository.chat('问题','request','steward');const assertion=expect(pending).rejects.toThrow('等待确认已超时');await jest.advanceTimersByTimeAsync(PRIVATE_REPLY_RECOVERY_MS);await assertion;expect(mockQueries[0].signal?.aborted).toBe(true);expect(mockInvoke).toHaveBeenCalledTimes(1);
});
test.each(['cancelled','excluded','account','mode'])('steward %s fence rejects a late existing response',async how=>{
 mockMode='steward';if(how==='mode')mockMode='companion';else mockReplyGate=async()=>{if(how==='cancelled')mockCancelled=true;if(how==='excluded')mockExcluded=true;if(how==='account')mockOwner='other';};
 await expect(recoverPrivateReply({...request,mode:'steward'},new AbortController().signal)).rejects.toThrow(/stopped|excluded|account_changed|confirmation_unavailable/);
});
