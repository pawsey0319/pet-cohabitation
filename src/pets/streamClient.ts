import { fetch as expoFetch } from "expo/fetch";
import { requireSupabase } from "../lib/supabase";

export type PrivateStreamEvent = {type:"accepted"|"phase"|"text"|"done"|"error";request_id?:string;message_id?:string;revision?:number;sequence?:number;content?:string;phase?:string;message?:Record<string,unknown>;error?:string};
export type PrivateChatOptions = {onEvent?:(event:PrivateStreamEvent)=>void;signal?:AbortSignal;imageAssetId?:string;imageAssetVersion?:number;contextRevision?:number};
export type PrivateReplyRecovery = {ownerId:string;requestId:string;revision?:number;mode?:"companion"|"steward"};
const controllers = new Map<string,AbortController>();
const cancellationReasons=new WeakMap<AbortController,string>();
let connectionId=0;
class ServerStreamError extends Error {}
function cancelOperation(controller:AbortController,reason:string){cancellationReasons.set(controller,reason);controller.abort(reason);}
export function abortPrivateStream(requestId:string):void { const controller=controllers.get(requestId);if(controller)cancelOperation(controller,"private_request_stopped"); }
export function abortAllPrivateStreams():void { for(const controller of controllers.values())cancelOperation(controller,"account_changed");controllers.clear(); }

/** Keep explicit cancellation distinct from a network failure, including during reconciliation. */
export async function withPrivateRequestCancellation<T>(requestId:string,signal:AbortSignal|undefined,run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const controller=new AbortController();controllers.set(requestId,controller);
  const cancel=()=>cancelOperation(controller,"private_request_stopped");
  if(signal?.aborted)cancel();else signal?.addEventListener("abort",cancel,{once:true});
  let rejectAbort=()=>{};
  try{
    const cancelled=new Promise<never>((_resolve,reject)=>{rejectAbort=()=>reject(new Error(cancellationReasons.get(controller)??"private_request_stopped"));controller.signal.addEventListener("abort",rejectAbort,{once:true});if(controller.signal.aborted)rejectAbort();});
    return await Promise.race([run(controller.signal),cancelled]);
  }finally{
    signal?.removeEventListener("abort",cancel);controller.signal.removeEventListener("abort",rejectAbort);
    if(controllers.get(requestId)===controller)controllers.delete(requestId);
  }
}

export async function chatWithStream(content:string,requestId:string,options:PrivateChatOptions,recover?:(request:PrivateReplyRecovery,signal:AbortSignal)=>Promise<Record<string,unknown>>):Promise<Record<string,unknown>> {
  if(Boolean(options.imageAssetId)!==Boolean(options.imageAssetVersion)||options.imageAssetId&&(!Number.isSafeInteger(options.imageAssetVersion)||options.imageAssetVersion!<1))throw new Error("vision_input_invalid");
  const client=requireSupabase(),session=(await client.auth.getSession()).data.session;
  if(!session)throw new Error("unauthenticated");
  const owner=session.user.id,controller=new AbortController();controllers.set(requestId,controller);
  const transport=new AbortController();let interruption:string|null=null,revision=options.contextRevision;
  const deadline=setTimeout(()=>{interruption="private_stream_timeout";transport.abort();},120000);
  const abortTransport=()=>transport.abort();controller.signal.addEventListener("abort",abortTransport,{once:true});
  const cancel=()=>cancelOperation(controller,"private_request_stopped");if(options.signal?.aborted)cancel();options.signal?.addEventListener("abort",cancel,{once:true});
  let channel:ReturnType<typeof client.channel>|undefined;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
    channel=client.channel(`private-stream:${requestId}:${++connectionId}`).on("postgres_changes",{event:"UPDATE",schema:"public",table:"pet_private_streams",filter:`request_id=eq.${requestId}`},payload=>{
      if(payload.new.owner_id!==owner)return;
      if(payload.new.status==="invalidated"||payload.new.status==="cancelled"){
        const reason=payload.new.status==="cancelled"?"private_request_stopped":"companion_context_changed";
        cancelOperation(controller,reason);options.onEvent?.({type:"error",error:reason,request_id:requestId});
      }
    }).subscribe();
    if(controller.signal.aborted)throw new Error(cancellationReasons.get(controller));
    const response=await expoFetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/,"")}/functions/v1/pet-chat`,{
      method:"POST",headers:{Authorization:`Bearer ${session.access_token}`,apikey:process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY??"","Content-Type":"application/json"},
      body:JSON.stringify({content,request_id:requestId,mode:"companion",stream:true,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,...(options.imageAssetId?{image_asset_id:options.imageAssetId,image_asset_version:options.imageAssetVersion}:{})}),signal:transport.signal,
    });
    if(!response.ok){
      if(response.status>=400&&response.status<500){let code=response.status===401?"unauthenticated":"private_stream_rejected";try{code=(await response.json())?.error??code;}catch{}throw new ServerStreamError(code);}
      throw new Error("private_stream_unavailable");
    }
    if(!response.body)throw new Error("private_stream_unavailable");
    if(!response.headers.get("content-type")?.includes("text/event-stream"))throw new Error("private_stream_unsupported");
    reader=response.body.getReader();const decoder=new TextDecoder();let buffer="";
    for(;;){
      const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});if(buffer.length>64000)throw new Error("private_stream_invalid");
      let end:number;
      while((end=buffer.indexOf("\n"))>=0){
        const line=buffer.slice(0,end).trimEnd();buffer=buffer.slice(end+1);
        if(!line.startsWith("data:"))continue;
        const event=JSON.parse(line.slice(5)) as PrivateStreamEvent;
        if((await client.auth.getSession()).data.session?.user.id!==owner)throw new ServerStreamError("account_changed");
        if(controller.signal.aborted)throw new Error(cancellationReasons.get(controller));
        if(event.type==="accepted"&&Number.isSafeInteger(event.revision))revision=event.revision;
        options.onEvent?.(event);
        if(event.type==="error")throw new ServerStreamError(event.error??"private_reply_failed");
        if(event.type==="done"&&event.message)return event.message;
      }
    }
    throw new Error("private_stream_interrupted");
  }catch(reason){
    clearTimeout(deadline);
    if(controller.signal.aborted)throw new Error(cancellationReasons.get(controller)??"private_request_stopped");
    if(reason instanceof ServerStreamError)throw reason;
    if(recover){
      options.onEvent?.({type:"phase",phase:"confirming",request_id:requestId});
      const reply=await recover({ownerId:owner,requestId,revision},controller.signal);
      if(controller.signal.aborted)throw new Error(cancellationReasons.get(controller)??"private_request_stopped");
      options.onEvent?.({type:"done",request_id:requestId,message:reply});return reply;
    }
    if(interruption)throw new Error(interruption);throw reason;
  }finally{
    clearTimeout(deadline);if(channel)void client.removeChannel(channel);
    options.signal?.removeEventListener("abort",cancel);
    controller.signal.removeEventListener("abort",abortTransport);
    if(controllers.get(requestId)===controller)controllers.delete(requestId);
    void reader?.cancel().catch(()=>undefined);try{reader?.releaseLock();}catch{/* A cancelled reader may already have released its lock. */}
  }
}
