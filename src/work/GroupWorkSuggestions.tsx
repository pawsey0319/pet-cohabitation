import { useCallback,useEffect,useRef,useState } from "react";
import { Text,View } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { AppButton } from "../ui/common";
import { createRequestId } from "../lib/uuid";
import { isLocalDemoMode,requireSupabase } from "../lib/supabase";
import { invokeWork,listWorkSuggestions,workOnline } from "./repository";
import { WorkEditor,WorkItemDetailSheet,friendlyError } from "./WorkItemsPanel";
import type { WorkSuggestion } from "./types";

export function GroupWorkSuggestions({spaceId}:{spaceId:string}){
 const {profile}=useSession();
 return profile?<GroupWorkSuggestionsContent key={`${profile.id}:${spaceId}`} spaceId={spaceId}/>:null;
}
function GroupWorkSuggestionsContent({spaceId}:{spaceId:string}){
 const {profile}=useSession();const {theme}=useAppTheme();const [data,setData]=useState<Awaited<ReturnType<typeof listWorkSuggestions>>|null>(null);const [expanded,setExpanded]=useState(false);const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [editing,setEditing]=useState<WorkSuggestion|null>(null);const [itemId,setItemId]=useState<string|null>(null);
 const current=useRef({active:true,generation:0});
 const load=useCallback(async()=>{if(isLocalDemoMode)return;const generation=++current.current.generation;try{const next=await listWorkSuggestions(spaceId);if(!current.current.active||generation!==current.current.generation)return;setData(next);setError("");}catch(reason){if(!current.current.active||generation!==current.current.generation)return;setData(null);setError(friendlyError(reason instanceof Error?reason.message:"群建议加载失败"));}},[spaceId]);
 useEffect(()=>{current.current.active=true;void load();if(isLocalDemoMode)return;const client=requireSupabase();const invalidate=()=>{current.current.generation++;setData(null);setEditing(null);setItemId(null);void load();};const channel=client.channel(`group-work:${spaceId}:${createRequestId()}`).on("postgres_changes",{event:"*",schema:"public",table:"group_work_authorizations",filter:`space_id=eq.${spaceId}`},invalidate).on("postgres_changes",{event:"*",schema:"public",table:"group_work_suggestions",filter:`space_id=eq.${spaceId}`},()=>void load()).on("postgres_changes",{event:"*",schema:"public",table:"space_members"},invalidate).subscribe();return ()=>{current.current.active=false;current.current.generation++;void client.removeChannel(channel);};},[load,spaceId]);
 const consent=async(value:boolean)=>{if(!data||busy)return;setBusy(true);try{if(!await workOnline())throw new Error("授权变更需要联网确认");await invokeWork("group-work-suggestions",{action:"consent",space_id:spaceId,expected_version:data.authorization.version,consented:value});await load();}catch(reason){setError(friendlyError(reason instanceof Error?reason.message:"授权失败"));}finally{setBusy(false);}};
 const dismiss=async(suggestionId:string)=>{setBusy(true);try{await invokeWork("group-work-suggestions",{action:"dismiss",suggestion_id:suggestionId,request_id:createRequestId()});await load();}catch(reason){setError(friendlyError(String((reason as Error).message)));}finally{setBusy(false);}};
 if(!profile||isLocalDemoMode)return null;
 const ownConsent=data?.consents.some(c=>c.user_id===profile.id&&c.version===data.authorization.version&&c.consented);
 return <View style={{padding:12,gap:8,borderColor:theme.line,borderWidth:1,borderRadius:theme.radius,backgroundColor:theme.card}}>
  <Text style={{color:theme.text,fontWeight:"600"}}>群待办识别</Text>
  <Text style={{color:theme.muted,lineHeight:20}}>{data?.authorization.active_since?"已获全员同意。讨论暂停 3 分钟后，群助手整理有原话依据的建议。":"需要所有成员独立同意。仅分析授权生效后的群消息；新成员加入或任何人撤回都会暂停。"}</Text>
  {data?<AppButton label={ownConsent?"撤回我的授权":"同意群待办识别"} variant="quiet" disabled={busy} onPress={()=>void consent(!ownConsent)}/>:null}
  {data?.suggestions.length?<AppButton label={expanded?"折叠建议":`发现 ${data.suggestions.length} 件可能要跟进的事`} variant="quiet" onPress={()=>setExpanded(!expanded)}/>:null}
  {expanded?data?.suggestions.map(suggestion=><View key={suggestion.id} style={{padding:10,gap:8,backgroundColor:theme.secondary,borderRadius:theme.radius}}><Text style={{color:theme.text,fontWeight:"600"}}>{suggestion.title}</Text><Text style={{color:theme.muted}}>{suggestion.description}</Text>{suggestion.sources.map((source,index)=><Text selectable key={`${source.message_id}:${index}`} style={{color:theme.muted,lineHeight:20}}>原话：“{source.quote}”</Text>)}<AppButton label="编辑并预览安排" variant="quiet" disabled={busy} onPress={()=>setEditing(suggestion)}/><AppButton label="仅我收起" variant="quiet" disabled={busy} onPress={()=>void dismiss(suggestion.id)}/></View>):null}
  {error?<Text onPress={()=>void load()} style={{color:theme.danger}}>{error}</Text>:null}
  {editing?<WorkEditor ownerId={profile.id} initial={{title:editing.title,description:editing.description,space_id:spaceId,kind:"task"}} onClose={()=>setEditing(null)} submitLabel="本人确认，接受建议并发布" onSubmit={(input,requestId)=>invokeWork("group-work-suggestions",{action:"accept",suggestion_id:editing.id,request_id:requestId,input:{...input,confirmed:true}})} onSaved={item=>{setEditing(null);setItemId(item.id);void load();}}/>:null}
  {itemId?<WorkItemDetailSheet ownerId={profile.id} itemId={itemId} onClose={()=>setItemId(null)} onChanged={()=>void load()}/>:null}
 </View>;
}
