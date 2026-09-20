import AsyncStorage from "@react-native-async-storage/async-storage";
import { parseVisionAttachment, type VisionAttachment } from "../vision/types";
export type PendingPrivateDraft = Readonly<{ content: string; id: string; attachment?: VisionAttachment }>;
const key=(ownerId:string)=>`pet-cohabitation-private-draft:${ownerId}`;
const writes=new Map<string,Promise<void>>();
const epochs=new Map<string,number>();
export async function loadPrivateDraft(ownerId:string):Promise<PendingPrivateDraft|null>{
  await writes.get(ownerId)?.catch(()=>undefined);
  const raw=await AsyncStorage.getItem(key(ownerId));
  try{const value=raw?JSON.parse(raw):null;if(!value||typeof value.id!=="string"||typeof value.content!=="string")return null;const attachment=parseVisionAttachment(value.attachment);if(value.attachment&&!attachment)throw new Error("图片草稿已无法恢复");return {...value,...(attachment?{attachment}:{})};}catch{return null;}
}
export async function savePrivateDraft(ownerId:string,value:PendingPrivateDraft|null):Promise<void>{
  const epoch=epochs.get(ownerId)??0;
  const serialized=value?JSON.stringify(value):null;
  const write=(writes.get(ownerId)??Promise.resolve()).catch(()=>undefined).then(async()=>{
    if(epoch!==(epochs.get(ownerId)??0))return;if(serialized)await AsyncStorage.setItem(key(ownerId),serialized);else await AsyncStorage.removeItem(key(ownerId));
  });
  writes.set(ownerId,write);
  try{await write;}finally{if(writes.get(ownerId)===write)writes.delete(ownerId);}
}
export async function clearPrivateDraft(ownerId:string):Promise<void>{epochs.set(ownerId,(epochs.get(ownerId)??0)+1);await writes.get(ownerId)?.catch(()=>undefined);await AsyncStorage.removeItem(key(ownerId));}
