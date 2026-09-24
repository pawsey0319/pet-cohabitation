import { MessageOutbox } from "./outbox";
import { createPersistentOutboxStore } from "./persistentOutbox";
import { removeStabilizedMedia } from "./mediaFile";
import type { AppProfile, ChatMessage, QueuedMessage } from "../data/types";
import type { ChatRepository } from "../data/chatRepository";
import { recordChatTiming } from "./performance";

export type DeliveryEvent = { spaceId: string; clientId: string; status: "uploading" | "sent" | "failed"; message?: ChatMessage };
const runtimes=new Map<string,ChatDeliveryRuntime>();
export class ChatDeliveryRuntime {
  readonly outbox: MessageOutbox;
  private listeners=new Set<(event:DeliveryEvent)=>void>();
  private enabled=true;
  private online=true;
  private retry:ReturnType<typeof setTimeout>|undefined;
  constructor(readonly profile: AppProfile, private repository: ChatRepository) {
    this.outbox=new MessageOutbox(createPersistentOutboxStore(profile.id));
  }
  subscribe(listener:(event:DeliveryEvent)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  private emit(event:DeliveryEvent){if(this.enabled)this.listeners.forEach(listener=>listener(event));}
  setOnline(online:boolean){this.online=online;if(online)void this.flush().catch(()=>undefined);}
  async enqueue(message:QueuedMessage){
    if(!this.enabled || message.senderId!==this.profile.id)throw new Error("发送账号已切换");
    const startedAt=Date.now();
    try { await this.outbox.enqueue(message);recordChatTiming("local_save",startedAt); }
    catch(error){recordChatTiming("local_save",startedAt,true);throw error;}
    void this.flush().catch(()=>undefined);
  }
  async flush():Promise<void>{
    if(!this.enabled || !this.online)return;
    clearTimeout(this.retry);
    const failed=await this.outbox.flush(async message=>{
      if(!this.enabled || !this.online)throw new Error("delivery_suspended");
      if(message.localMediaUri)this.emit({spaceId:message.spaceId,clientId:message.clientId,status:"uploading"});
      const startedAt=Date.now();
      let receipt:ChatMessage;
      try { receipt=await this.repository.sendMessage(message,this.profile.nickname);recordChatTiming("send_receipt",startedAt); }
      catch(error){recordChatTiming("send_receipt",startedAt,true);throw error;}
      if(!this.enabled)return;
      this.emit({spaceId:message.spaceId,clientId:message.clientId,status:"sent",message:receipt});
      if(message.localMediaUri)void removeStabilizedMedia(message.localMediaUri).catch(()=>undefined);
    });
    if(!this.enabled)return;
    failed.forEach(message=>this.emit({spaceId:message.spaceId,clientId:message.clientId,status:"failed"}));
    if(failed.some(message=>message.attempts<3) && this.online)
      this.retry=setTimeout(()=>void this.flush().catch(()=>undefined),Math.min(30000,2000*2**Math.max(...failed.map(m=>m.attempts))));
  }
  stop(){this.enabled=false;clearTimeout(this.retry);this.listeners.clear();}
}
export function getChatDelivery(profile:AppProfile,repository:ChatRepository){
  let runtime=runtimes.get(profile.id);
  if(!runtime){runtime=new ChatDeliveryRuntime(profile,repository);runtimes.set(profile.id,runtime);}
  return runtime;
}
export function stopChatDelivery(owner:string){runtimes.get(owner)?.stop();runtimes.delete(owner);}
export async function clearChatDelivery(owner:string){
  const runtime=runtimes.get(owner);stopChatDelivery(owner);
  await (runtime?.outbox ?? new MessageOutbox(createPersistentOutboxStore(owner))).clear();
}
export function exportPendingChatMessages(owner:string){return new MessageOutbox(createPersistentOutboxStore(owner)).list();}
