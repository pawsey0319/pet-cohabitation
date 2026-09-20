import { Pressable, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import type { useSystemVoice } from "./useSystemVoice";
type Voice = ReturnType<typeof useSystemVoice>;
export function VoiceInputButton({ voice,compact=false,expanded=false,onToggle }: { voice: Voice;compact?:boolean;expanded?:boolean;onToggle?():void }) {
  const { theme } = useAppTheme(); const listening = ["starting", "listening", "processing"].includes(voice.status); const checking = voice.supported && !voice.capabilities && !voice.error;
  if(compact)return <Pressable accessibilityRole="button" accessibilityLabel="语音输入" accessibilityState={{expanded}} onPress={onToggle} style={{minHeight:44,paddingHorizontal:10,justifyContent:"center"}}><Text style={{color:theme.primary}}>{listening?"语音 · 识别中":checking?"语音 · 检查中":!voice.supported||voice.capabilities&&!voice.capabilities.recognition?"语音 · 不支持":"语音输入"}</Text></Pressable>;
  return <View style={{ gap: 6 }}><View style={{ flexDirection: "row", gap: 12 }}><Pressable accessibilityRole="button" disabled={checking || voice.status === "starting"} onPress={() => void (listening ? voice.finish() : voice.listen())} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: "center" }}><Text style={{ color: theme.primary }}>{checking ? "检查语音…" : voice.status === "starting" ? "准备语音…" : listening ? "结束识别" : "语音输入"}</Text></Pressable>{listening ? <Pressable accessibilityRole="button" onPress={() => void voice.stop()} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: theme.muted }}>取消</Text></Pressable> : null}</View>
    {voice.partial ? <Text style={{ color: theme.muted }}>{voice.partial}</Text> : null}
    {voice.error ? <Text accessibilityLiveRegion="polite" style={{ color: theme.muted, fontSize: 12 }}>{voice.error}</Text> : null}
    <Text style={{ color: theme.muted, fontSize: 12 }}>识别结果先填入输入框，确认后再发送。系统识别服务可能联网处理音频。</Text>
  </View>;
}
export function VoiceInputPanel({voice,onClose}:{voice:Voice;onClose():void}){
 const {theme}=useAppTheme();const listening=["starting","listening","processing"].includes(voice.status);const checking=voice.supported&&!voice.capabilities&&!voice.error;const unavailable=!voice.supported||voice.capabilities&&!voice.capabilities.recognition;
 return <View style={{gap:4,paddingHorizontal:10,paddingVertical:6,borderWidth:1,borderColor:theme.line,borderRadius:8}}>
  <Text style={{color:theme.muted,fontSize:12,lineHeight:18}}>{unavailable?"当前设备暂不支持语音识别，可继续输入文字。":"识别结果先填入输入框，再由你发送。系统识别服务可能联网处理音频。"}</Text>
  {voice.partial?<Text numberOfLines={2} style={{color:theme.text,fontSize:14}}>{voice.partial}</Text>:null}
  {voice.error?<Text accessibilityLiveRegion="polite" style={{color:theme.muted,fontSize:12}}>{voice.error}</Text>:null}
  <View style={{flexDirection:"row",alignItems:"center",gap:12}}>{!unavailable?<Pressable accessibilityRole="button" disabled={checking||voice.status==="starting"} onPress={()=>void(listening?voice.finish():voice.listen())} style={{minHeight:44,justifyContent:"center"}}><Text style={{color:theme.primary}}>{checking?"检查语音…":voice.status==="starting"?"准备语音…":listening?"结束识别":"开始识别"}</Text></Pressable>:null}<Pressable accessibilityRole="button" onPress={()=>{if(listening)void voice.stop();onClose();}} style={{minHeight:44,justifyContent:"center"}}><Text style={{color:theme.muted}}>{listening?"取消识别":"收起语音"}</Text></Pressable></View>
 </View>;
}
export function SpeakButton({ voice, messageId, text }: { voice: Voice; messageId: string; text: string }) {
  const { theme } = useAppTheme(); const active = voice.speakingMessageId === messageId;
  return <Pressable accessibilityRole="button" accessibilityLabel={active ? "停止朗读" : "朗读这条消息"} onPress={() => void (active ? voice.stop() : voice.speak(messageId, text))} style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: "center" }}><Text style={{ color: theme.muted, fontSize: 13 }}>{active ? "停止朗读" : "朗读"}</Text></Pressable>;
}
