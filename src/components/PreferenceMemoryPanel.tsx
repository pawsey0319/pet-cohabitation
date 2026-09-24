import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { MemoryEvidence, PreferenceView } from "../../supabase/functions/_shared/preferenceMemory";
import type { MemoryEvidencePage, PreferenceAction } from "../data/types";
import { AppButton, Surface } from "../ui/common";
import { colors, radii, spacing } from "../theme/tokens";

type Props = Readonly<{ preferences: readonly PreferenceView[]; pending: number; failed: number; busy: boolean; onUpdate(input: PreferenceAction): Promise<void>; onListEvidence(key:string,offset?:number): Promise<MemoryEvidencePage>; onRetry(): Promise<void> }>;
const stateLabel = (item: PreferenceView) => item.status === "not_recommended" ? (item.hadPositive ? "曾经喜欢 · 现在不推荐" : "现在不推荐") : item.status === "past" ? "过去的偏好" : "当前偏好";
export function PreferenceMemoryPanel(props: Props) {
  const [open,setOpen]=useState(false); const [limit,setLimit]=useState(10);
  const [detail,setDetail]=useState<{key:string;object:string;items:readonly MemoryEvidence[];nextOffset:number|null}|null>(null);
  const [confirmation,setConfirmation]=useState<PreferenceAction|null>(null);
  const [working,setWorking]=useState(false); const [error,setError]=useState<string|null>(null);
  const busy=working||props.busy;
  const perform=async(operation:()=>Promise<void>)=>{if(busy)return;setWorking(true);setError(null);try{await operation();}catch(e){setError(e instanceof Error ? e.message : "暂时没能完成，请重试");}finally{setWorking(false);}};
  const showEvidence=(item:PreferenceView)=>perform(async()=>{const page=await props.onListEvidence(item.key);setDetail({key:item.key,object:item.object,items:page.items,nextOffset:page.nextOffset});});
  return <View style={styles.section}>
    <View style={styles.row}><View style={styles.heading}><Text style={styles.title}>我逐渐了解的你</Text><Text style={styles.muted}>从你明确的偏好中积累 · 仅用于私聊</Text></View><Pressable accessibilityRole="button" onPress={()=>setOpen(!open)}><Text style={styles.action}>{open?"收起偏好":"查看偏好"}</Text></Pressable></View>
    {props.pending>0?<Text style={styles.muted}>正在整理最近的表达，聊天可以继续。</Text>:null}
    {props.failed>0?<View style={styles.row}><Text style={styles.muted}>有些表达暂未记下，不影响聊天。</Text><AppButton label="重试记忆整理" variant="quiet" disabled={busy} onPress={()=>void perform(props.onRetry)}/></View>:null}
    {open?<View style={styles.list}>
      <Text style={styles.muted}>最近表达、不同日期的提及和表达强度都会影响参考顺序。明确“不再喜欢”会停止当前推荐，旧经历仍保留。</Text>
      {!props.preferences.length?<Text style={styles.muted}>还没有明确的偏好。你可以自然地告诉我喜欢什么，或希望怎样相处。</Text>:null}
      {props.preferences.slice(0,limit).map((item)=><View key={item.key} style={styles.card}>
        <View style={styles.row}><Text style={styles.object}>{item.object}{item.context!=="global"?` · ${item.context}`:""}</Text><Text style={styles.status}>{stateLabel(item)}</Text></View>
        <Text style={styles.muted}>{item.reasons.join(" · ")}</Text>
        <Text style={styles.quote} numberOfLines={3}>“{item.quote}”</Text>
        <Text style={styles.muted}>{new Date(item.lastExpressedAt).toLocaleString("zh-CN")}</Text>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel={`查看依据：${item.object}`} disabled={busy} onPress={()=>void showEvidence(item)}><Text style={styles.action}>查看变化依据</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`标记重要：${item.object}`} disabled={busy||item.status!=="current"} onPress={()=>void perform(()=>props.onUpdate({key:item.key,action:"important",important:!item.important}))}><Text style={item.status==="current"?styles.action:styles.muted}>{item.important?"取消重要":"标记重要"}</Text></Pressable>
        </View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel={`改变偏好：${item.object}`} disabled={busy} onPress={()=>{setError(null);setConfirmation({key:item.key,action:item.status==="current"?"negative":"positive"});}}><Text style={styles.action}>{item.status==="current"?"现在不喜欢了":"现在喜欢了"}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`纠正偏好：${item.object}`} disabled={busy} onPress={()=>{setError(null);setConfirmation({key:item.key,action:"retract"});}}><Text style={styles.action}>这项理解记错了</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`忘记偏好：${item.object}`} disabled={busy} onPress={()=>{setError(null);setConfirmation({key:item.key,action:"forget"});}}><Text style={styles.remove}>忘记这项偏好</Text></Pressable>
        </View>
      </View>)}
      {props.preferences.length>limit?<AppButton label="查看更多偏好" variant="quiet" onPress={()=>setLimit(limit+10)}/>:null}
    </View>:null}
    {error&&!confirmation&&!detail?<Text accessibilityRole="alert" style={styles.remove}>{error}</Text>:null}
    <Modal visible={Boolean(detail)} transparent animationType="fade" onRequestClose={()=>{if(!busy)setDetail(null);}}><View style={styles.overlay}><Surface style={styles.modal}>
      <Text style={styles.title}>{detail?.object} · 变化依据</Text>
      <ScrollView style={styles.history} contentContainerStyle={styles.list}>
        {detail?.items.map((item)=><View key={item.id} style={styles.card}>
          <Text style={styles.muted}>{new Date(item.occurredAt).toLocaleString("zh-CN")} · {item.origin==="manual"?"你在记忆中主动更新":"来自你的私聊"}</Text>
          <Text style={styles.quote}>{item.state==="forgotten"?"这条依据已停止使用。":item.quote}</Text>
          <Text style={styles.muted}>{item.state==="retracted"?"已纠正，不再作为你的真实经历":item.state==="forgotten"?"原来源不会重新自动记入":item.operation!=="observe"?"你提出了纠正或忘记":item.temporal==="past"?"当时描述过去的偏好":item.polarity==="negative"?"明确不喜欢 / 不适用":"明确喜欢"}</Text>
          {item.state==="active"&&item.operation==="observe"?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setConfirmation({key:detail.key,action:"retract",evidenceId:item.id});setDetail(null);}}><Text style={styles.action}>只纠正这条依据</Text></Pressable>:null}
        </View>)}
        {detail&&detail.nextOffset!==null?<AppButton label="更多历史依据" variant="quiet" disabled={busy} onPress={()=>void perform(async()=>{if(!detail||detail.nextOffset===null)return;const page=await props.onListEvidence(detail.key,detail.nextOffset);setDetail({...detail,items:[...detail.items,...page.items],nextOffset:page.nextOffset});})}/>:null}
      </ScrollView>
      {error?<Text style={styles.remove}>{error}</Text>:null}<AppButton label="关闭依据" variant="quiet" disabled={busy} onPress={()=>setDetail(null)}/>
    </Surface></View></Modal>
    <Modal visible={Boolean(confirmation)} transparent animationType="fade" onRequestClose={()=>{if(!busy)setConfirmation(null);}}><View style={styles.overlay}><Surface style={styles.modal}>
      <Text style={styles.title}>{confirmation?.action==="forget"?"忘记这项偏好？":confirmation?.action==="retract"?"纠正这项理解？":"记下你的变化"}</Text>
      <Text style={styles.muted}>{confirmation?.action==="forget"?"这项偏好和已关联的依据会停止用于后续回应，原始聊天仍可回看。原来源不会重新自动记入；你以后新的明确表达仍可形成新记忆。":confirmation?.action==="retract"?"选中的错误依据将停止使用，不再把它当成你真实的过去。原聊天保留，其他话题可以继续。":"保留过去的表达，并记下你现在的偏好。我们可以继续当前的话题。"}</Text>
      {error?<Text accessibilityRole="alert" style={styles.remove}>{error}</Text>:null}
      <AppButton label="取消" variant="quiet" disabled={busy} onPress={()=>setConfirmation(null)}/>
      <AppButton label={confirmation?.action==="forget"?"确认忘记偏好":confirmation?.action==="retract"?"确认纠正理解":"确认偏好变化"} disabled={busy} onPress={()=>void perform(async()=>{if(!confirmation)return;await props.onUpdate(confirmation);setConfirmation(null);})}/>
    </Surface></View></Modal>
  </View>;
}
const styles=StyleSheet.create({section:{gap:12,borderTopWidth:1,borderColor:colors.line,paddingTop:16},row:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"},heading:{flex:1,gap:5},title:{fontSize:16,fontWeight:"800",color:colors.text},muted:{fontSize:12,color:colors.textMuted,lineHeight:20},action:{fontSize:12,color:colors.mint,paddingVertical:6},remove:{fontSize:12,color:colors.coralSoft,lineHeight:20},list:{gap:12},card:{backgroundColor:colors.surface,borderRadius:radii.md,padding:12,gap:6},object:{color:colors.text,fontSize:16,fontWeight:"700",flexShrink:1},status:{color:colors.mint,fontSize:11},quote:{color:colors.text,lineHeight:22},actions:{flexDirection:"row",flexWrap:"wrap",gap:16},overlay:{flex:1,backgroundColor:"rgba(4,3,13,.82)",justifyContent:"center",alignItems:"center",padding:spacing.md},modal:{width:"100%",maxWidth:520,maxHeight:"90%",gap:12},history:{maxHeight:430}});
