import {useCallback,useEffect,useRef,useState} from "react";
import {Text,View} from "react-native";
import {router} from "expo-router";
import {useSession} from "../auth/SessionProvider";
import {useAppTheme} from "../theme/ThemeProvider";
import {isLocalDemoMode,requireSupabase} from "../lib/supabase";
import {createRequestId} from "../lib/uuid";
import {AppButton} from "../ui/common";
import {invokeWork} from "./repository";

type Preview={id:string;space_id:string;space_name:string;exact_content:string;status:"pending"|"confirmed"|"dismissed";version:number;expires_at:string;message_id:string|null};
export function StewardActionCard({sourceMessageId}:{sourceMessageId:string}){const{profile}=useSession();return profile&&!isLocalDemoMode?<OwnerStewardAction key={`${profile.id}:${sourceMessageId}`} ownerId={profile.id} sourceMessageId={sourceMessageId}/>:null;}
function OwnerStewardAction({ownerId,sourceMessageId}:{ownerId:string;sourceMessageId:string}){
 const{theme}=useAppTheme();const[preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const active=useRef(true),generation=useRef(0),attempt=useRef<{action:string;version:number;request:string}|null>(null);
 const load=useCallback(async()=>{const revision=++generation.current;try{const result=await requireSupabase().from("pet_steward_previews").select("id,space_id,space_name,exact_content,status,version,expires_at,message_id").eq("owner_id",ownerId).eq("source_message_id",sourceMessageId).maybeSingle();if(!active.current||revision!==generation.current)return;if(result.error){setPreview(null);return;}setPreview(result.data as Preview|null);}catch{if(active.current&&revision===generation.current)setPreview(null);}},[ownerId,sourceMessageId]);
 useEffect(()=>{active.current=true;void load();const client=requireSupabase();const invalidate=()=>{generation.current++;setPreview(null);setError("");void load();};const channel=client.channel(`steward-preview:${createRequestId()}`).on("postgres_changes",{event:"*",schema:"public",table:"pet_steward_previews",filter:`owner_id=eq.${ownerId}`},()=>void load()).on("postgres_changes",{event:"DELETE",schema:"public",table:"pet_steward_previews"},invalidate).on("postgres_changes",{event:"UPDATE",schema:"public",table:"pet_private_threads",filter:`id=eq.${sourceMessageId}`},invalidate).on("postgres_changes",{event:"*",schema:"public",table:"pet_private_context_exclusions",filter:`owner_id=eq.${ownerId}`},invalidate).on("postgres_changes",{event:"*",schema:"public",table:"space_members",filter:`user_id=eq.${ownerId}`},invalidate).subscribe();return()=>{active.current=false;generation.current++;void client.removeChannel(channel);};},[load,ownerId,sourceMessageId]);
 const decide=async(action:"confirm"|"dismiss")=>{if(!preview||busy)return;setBusy(true);setError("");if(attempt.current?.action!==action||attempt.current.version!==preview.version)attempt.current={action,version:preview.version,request:createRequestId()};
  try{await invokeWork("steward-actions",{action,preview_id:preview.id,expected_version:preview.version,request_id:attempt.current.request});if(active.current){attempt.current=null;await load();}}
  catch(reason){if(active.current){const message=reason instanceof Error?reason.message:"";setError(/excluded|changed|not_space_member|forbidden/.test(message)?"来源或群权限已变化，这份预览不能继续使用。":/expired/.test(message)?"这份预览已过期，请重新提出代发。":/conflict|resolved/.test(message)?"这份预览已更新，请查看最新状态。":"操作未确认成功，可以重试；同一请求不会重复发布。");if(/excluded|changed|not_space_member|forbidden/.test(message))setPreview(null);else await load();}}
  finally{if(active.current)setBusy(false);}
 };
 if(!preview)return error?<Text style={{color:theme.danger}}>{error}</Text>:null;
 const expired=Date.parse(preview.expires_at)<=Date.now();
 return <View style={{padding:12,gap:10,borderWidth:1,borderColor:theme.line,borderRadius:12,backgroundColor:theme.card}}>
  <Text style={{color:theme.text,fontWeight:"700"}}>{preview.status==="confirmed"?"已发布":preview.status==="dismissed"?"已取消代发":expired?"代发预览已过期":"代发预览 · 待本人确认"} · {preview.space_name}</Text>
  <Text selectable style={{color:theme.text}}>{preview.exact_content}</Text>
  <Text style={{color:theme.muted}}>{preview.status==="confirmed"?"异宠代本人发布 · 本人已确认":preview.status==="pending"?"确认后才会将上方原文发到这个群，署名“异宠代本人发布 · 本人已确认”。":"没有发布这份预览。"}</Text>
  {preview.status==="pending"&&!expired?<><AppButton label="本人确认，逐字发布" disabled={busy} onPress={()=>void decide("confirm")}/><AppButton label="取消这次代发" disabled={busy} onPress={()=>void decide("dismiss")}/></>:null}
  {preview.status==="confirmed"&&preview.message_id?<AppButton label="查看已发布消息" onPress={()=>router.push({pathname:"/chat/[spaceId]",params:{spaceId:preview.space_id,messageId:preview.message_id!}})}/>:null}
  {error?<Text style={{color:theme.danger}}>{error}</Text>:null}
 </View>;
}
