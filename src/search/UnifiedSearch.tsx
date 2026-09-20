import {useCallback,useEffect,useRef,useState} from "react";
import {ActivityIndicator,AppState,Pressable,Text,View} from "react-native";
import {router,useFocusEffect} from "expo-router";
import {useSession} from "../auth/SessionProvider";
import {useAppTheme} from "../theme/ThemeProvider";
import {requireSupabase} from "../lib/supabase";
import {KeyboardScrollView,KeyboardTextInput} from "../components/KeyboardLayout";
import {AppButton} from "../ui/common";

type Result={id:string;type:"message"|"work"|"memory";title:string;snippet:string;createdAt:string;spaceId:string|null;sourceMessageId:string|null;route:string};
type SearchState={identity:string;results:Result[];busy:boolean;searched:boolean;error:string;more:boolean;offset:number;method:"keyword"|"semantic";coverage?:string};
const empty=(identity:string):SearchState=>({identity,results:[],busy:false,searched:false,error:"",more:false,offset:0,method:"keyword"});
function dateBoundary(value:string,after=false):string|null{
 if(!value)return null;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error("日期请使用 YYYY-MM-DD 格式。");
 const [year,month,day]=value.split("-").map(Number);const date=new Date(year,month-1,day);
 if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day)throw new Error("请输入真实存在的日期。");
 if(after)date.setDate(date.getDate()+1);return date.toISOString();
}
export function UnifiedSearch(props:{initialQuery?:string;spaceId?:string}){
 const {profile}=useSession();
 return <UnifiedSearchSession key={profile?.id??"signed-out"} {...props}/>;
}
function UnifiedSearchSession({initialQuery="",spaceId}:{initialQuery?:string;spaceId?:string}){
  const {profile,isLocalDemo}=useSession(),{theme}=useAppTheme();
  const [query,setQuery]=useState(initialQuery),[kind,setKind]=useState("all"),[from,setFrom]=useState(""),[until,setUntil]=useState(""),[status,setStatus]=useState("");
  const identity=JSON.stringify([profile?.id,isLocalDemo,spaceId,query,kind,from,until,kind==="work"?status:""]);
  const [state,setState]=useState<SearchState>(()=>empty(identity));
  const epoch=useRef(0),activeIdentity=useRef(identity),mounted=useRef(true),inflight=useRef<number|null>(null);activeIdentity.current=identity;
  // Never render data from an earlier account or filter, including the render before effects run.
  const visible=state.identity===identity?state:empty(identity);
  const invalidate=useCallback(()=>{epoch.current++;inflight.current=null;if(mounted.current)setState(empty(activeIdentity.current));},[]);
  useEffect(()=>{invalidate();},[identity,invalidate]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;inflight.current=null;};},[]);
  useFocusEffect(useCallback(()=>{invalidate();return()=>invalidate();},[invalidate]));
  useEffect(()=>{
    if(!profile||isLocalDemo)return;
    const client=requireSupabase();let active=true;
    const clear=()=>{if(active)invalidate();};
    const channel=client.channel(`unified-search:${profile.id}:${Math.random().toString(36).slice(2)}`);
    // DELETE payloads may contain only primary keys; an unfiltered subscription still uses server RLS.
    for(const table of ["space_members","work_items","pet_private_context_exclusions","pet_memory_evidence","pet_life_facts"]){
      channel.on("postgres_changes",{event:"*",schema:"public",table},clear);
    }
    channel.subscribe(status=>{if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"||status==="CLOSED")clear();});
    const listener=AppState.addEventListener("change",()=>clear());
    return()=>{active=false;listener.remove();void client.removeChannel(channel);};
  },[profile?.id,isLocalDemo,invalidate]);
  const search=async(append=false)=>{
    if(!profile||!query.trim()||(inflight.current!==null&&visible.method!=="semantic"))return;
    const owner=profile.id,version=++epoch.current,requestIdentity=identity;inflight.current=version;
    const offset=append?visible.offset:0;
    setState(current=>({...append&&current.identity===identity?current:empty(identity),busy:true,error:""}));
    const isCurrent=()=>mounted.current&&activeIdentity.current===requestIdentity&&epoch.current===version;
    try{
      if(isLocalDemo)throw new Error("统一搜索需要登录云端账号；本地演示没有云端资料。");
      const start=dateBoundary(from),end=dateBoundary(until,true);
      if(from&&until&&from>until)throw new Error("起始日期不能晚于截止日期。");
      const result=await requireSupabase().rpc("search_owned_content",{p_owner:owner,p_query:query.trim(),p_types:kind==="all"?["message","work","memory"]:[kind],p_space:spaceId??null,p_from:start,p_until:end,p_status:kind==="work"?status||null:null,p_limit:30,p_offset:offset});
      if(result.error)throw result.error;if(!isCurrent())return;
      const page:Result[]=result.data??[];
      setState(current=>{
        const combined=append&&current.identity===requestIdentity?[...current.results,...page]:page;
        const unique=new Map(combined.map(row=>[`${row.type}:${row.id}`,row]));
        return {identity:requestIdentity,results:[...unique.values()],busy:false,searched:true,error:"",more:page.length===30,offset:offset+page.length,method:"keyword"};
      });
    }catch(reason){if(isCurrent())setState(current=>({...current,busy:false,error:reason instanceof Error?reason.message:"暂未完成搜索，请重试。"}));}
    finally{if(inflight.current===version)inflight.current=null;if(isCurrent())setState(current=>({...current,busy:false}));}
  };
  const semantic=async()=>{
    if(!profile||!query.trim()||inflight.current!==null)return;
    const version=++epoch.current,requestIdentity=identity;inflight.current=version;
    const prior=visible;
    setState(current=>({...current.identity===identity?current:empty(identity),busy:true,error:"",method:"semantic"}));
    const isCurrent=()=>mounted.current&&activeIdentity.current===requestIdentity&&epoch.current===version;
    try{
      if(isLocalDemo)throw new Error("cloud_required");
      const start=dateBoundary(from),end=dateBoundary(until,true);
      if(from&&until&&from>until)throw new Error("invalid_dates");
      const result=await requireSupabase().functions.invoke("semantic-search",{body:{query:query.trim(),types:kind==="all"?["message","work","memory"]:[kind],space_id:spaceId??null,from:start,until:end,status:kind==="work"?status||null:null}});
      if(result.error)throw result.error;if(!isCurrent())return;
      setState({identity:requestIdentity,results:result.data.results??[],busy:false,searched:true,error:"",more:false,offset:0,method:"semantic",coverage:result.data.coverage});
    }catch{if(isCurrent())setState({...prior,busy:false,error:"按意思查找暂时不可用。原有关键词结果仍保留，也可以继续点击查找。"});}
    finally{if(inflight.current===version)inflight.current=null;if(isCurrent())setState(current=>({...current,busy:false}));}
  };
  const change=(setter:(value:string)=>void)=>(value:string)=>{invalidate();setter(value);};
  return <KeyboardScrollView contentContainerStyle={{padding:18,gap:14}} keyboardShouldPersistTaps="handled">
    <Text style={{color:theme.text,fontSize:24,fontWeight:"700"}}>搜索</Text>
    <Text style={{color:theme.muted,lineHeight:20}}>{spaceId?"当前群的消息与事项":"你有权查看的消息、事项和个人记忆"} · 已停用的记忆来源不参与搜索</Text>
    <KeyboardTextInput accessibilityLabel="搜索消息事项记忆" value={query} onChangeText={change(setQuery)} maxLength={80} placeholder="输入关键词" style={{minHeight:48,borderWidth:1,borderColor:theme.line,borderRadius:theme.radius,color:theme.text,padding:12}}/>
    <View style={{flexDirection:"row",gap:14}}>{[["all","全部"],["message","消息"],["work","事项"],["memory","记忆"]].map(([key,label])=><Pressable key={key} accessibilityRole="button" onPress={()=>change(setKind)(key)}><Text style={{paddingVertical:10,color:kind===key?theme.primary:theme.muted}}>{label}</Text></Pressable>)}</View>
    <View style={{flexDirection:"row",gap:10}}>{([{value:from,set:setFrom,label:"起始日期"},{value:until,set:setUntil,label:"截止日期"}]).map(({value,set,label})=><KeyboardTextInput key={label} accessibilityLabel={label} placeholder={`${label} YYYY-MM-DD`} value={value} onChangeText={change(set)} style={{flex:1,minHeight:44,color:theme.text,borderBottomWidth:1,borderColor:theme.line}}/>)}</View>
    {kind==="work"?<View style={{flexDirection:"row",flexWrap:"wrap",gap:12}}>{[["","所有状态"],["pending_acceptance","待接受"],["not_started","待开始"],["in_progress","进行中"],["pending_review","待验收"],["completed","已完成"],["cancelled","已取消"]].map(([key,label])=><Pressable key={key} accessibilityRole="button" onPress={()=>change(setStatus)(key)}><Text style={{paddingVertical:8,color:status===key?theme.primary:theme.muted}}>{label}</Text></Pressable>)}</View>:null}
    <AppButton label="查找" disabled={(visible.busy&&visible.method!=="semantic")||!query.trim()||!profile} onPress={()=>void search()}/>
    <AppButton label="按意思找" variant="secondary" disabled={visible.busy||!query.trim()||!profile} onPress={()=>void semantic()}/>
    {visible.method==="semantic"?<Text style={{color:theme.muted}}>{visible.busy?"正在按意思查找，关键词查找仍可使用。":visible.coverage}</Text>:null}
    {visible.busy?<ActivityIndicator color={theme.primary}/>:null}{visible.error?<Text accessibilityRole="alert" style={{color:theme.danger}}>{visible.error}</Text>:null}
    {(["message","work","memory"] as const).map(type=>{const rows=visible.results.filter(r=>r.type===type);return rows.length?<View key={type} style={{gap:10}}><Text style={{color:theme.muted}}>{{message:"消息",work:"事项",memory:"记忆"}[type]}</Text>{rows.map(r=><Pressable key={`${r.type}:${r.id}`} onPress={()=>router.push(r.route as never)} style={{padding:14,gap:6,backgroundColor:theme.card,borderWidth:1,borderColor:theme.line,borderRadius:theme.radius}}><Text style={{color:theme.text,fontWeight:"600"}}>{r.title}</Text><Text numberOfLines={4} style={{color:theme.text,lineHeight:22}}>{r.snippet}</Text><Text style={{color:theme.muted,fontSize:12}}>{new Date(r.createdAt).toLocaleString("zh-CN")} · 查看来源</Text></Pressable>)}</View>:null;})}
    {visible.searched&&!visible.results.length?<Text style={{color:theme.muted}}>这个范围内没有找到匹配资料，可以换关键词或日期。未找到不代表事情从未发生。</Text>:null}
    {visible.more?<AppButton variant="quiet" label="更多结果" onPress={()=>void search(true)} disabled={visible.busy}/>:null}
  </KeyboardScrollView>;
}
