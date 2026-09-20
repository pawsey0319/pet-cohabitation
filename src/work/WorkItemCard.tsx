import { useCallback,useEffect,useState } from "react";
import { Pressable,Text,View } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { getWorkDetail,subscribeWorkData } from "./repository";
import { isOverdue } from "./domain";
import { workKindLabel,workStatusLabel,type WorkItem } from "./types";

/** Cards resolve the canonical item ID; they never store their own progress. */
export function WorkItemCard({itemId,item:provided,onOpen}:{itemId?:string;item?:WorkItem;onOpen?:(itemId:string)=>void}) {
  const {profile}=useSession();const {theme}=useAppTheme();const [loaded,setLoaded]=useState<WorkItem|null>(null);const [error,setError]=useState("");
  const load=useCallback(()=>{if(provided||!profile||!itemId)return;void getWorkDetail(profile.id,itemId).then(detail=>{setLoaded(detail.item);setError("");}).catch(()=>{setLoaded(null);setError("此事项已不可用或当前无权查看");});},[provided,profile?.id,itemId]);
  useEffect(()=>{load();return profile?subscribeWorkData(profile.id,load):undefined;},[load,profile?.id]);
  const item=provided??loaded;
  if(!item)return <Text style={{color:theme.muted,padding:12}}>{error||"正在加载事项…"}</Text>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`查看事项：${item.title}`} onPress={()=>onOpen?.(item.id)} style={{padding:16,gap:8,borderWidth:1,borderColor:theme.line,borderRadius:theme.radius,backgroundColor:theme.card}}>
    <View style={{flexDirection:"row",justifyContent:"space-between",gap:12}}><Text style={{color:theme.muted,fontSize:12}}>{item.space_id?"群事项":"个人"} · {workKindLabel[item.kind]}</Text><Text style={{color:item.sync_state?theme.accent:theme.muted,fontSize:12}}>{item.sync_state==="conflict"?"同步冲突":item.sync_state==="pending"?"待同步":item.publication==="draft"?"待发布":workStatusLabel[item.status]}</Text></View>
    <Text style={{color:theme.text,fontSize:16,fontWeight:"600"}}>{item.title}</Text>
    {item.description?<Text numberOfLines={2} style={{color:theme.muted,lineHeight:20}}>{item.description}</Text>:null}
    {item.due_at?<Text style={{color:isOverdue(item)?theme.danger:theme.muted,fontSize:12}}>{isOverdue(item)?"已逾期 · ":"截止 "}{new Date(item.due_at).toLocaleString("zh-CN",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</Text>:null}
    {!item.terms_valid?<Text style={{color:theme.danger,fontSize:12}}>原约定需要重新分配或确认</Text>:null}
    {item.sync_state?<Text style={{color:theme.muted,fontSize:12}}>修改尚未在云端生效，云端原提醒保持不变</Text>:null}
  </Pressable>;
}
