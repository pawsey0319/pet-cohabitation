import { ChatBackgroundEditor } from "../backgrounds/ChatBackgroundEditor";
import { ChatBackgroundSurface, useChatBackgroundColors } from "../backgrounds/ChatBackgroundSurface";
import { Icon } from "../ui/Icon";
import { createThemedStyles } from "../theme/themedStyles";
import { KeyboardScreen, KeyboardScrollView, KeyboardTextInput } from "./KeyboardLayout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../auth/SessionProvider";
import { AppButton } from "../ui/common";
import { WorkEditor,WorkItemDetailSheet } from "../work/WorkItemsPanel";
import { StewardActionCard } from "../work/StewardActionCard";
import { invokeWork } from "../work/repository";
import type { WorkInput } from "../work/types";
import { ReminderEditor } from "../notifications/ReminderEditor";
import { createRequestId } from "../lib/uuid";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ChatRepository } from "../data/chatRepository";
import type { AgentRequest, AgentRequestKind } from "../data/types";
import { colors, radii, spacing } from "../theme/tokens";

const KINDS: readonly Readonly<{ kind: AgentRequestKind; label: string; hint: string }>[] = [
  { kind: "read_summary", label: "群聊简报", hint: "总结最近发生的事" },
  { kind: "read_query", label: "查询消息", hint: "按问题查当前群消息" },
  { kind: "delegated_message", label: "代发原文", hint: "必须逐字发送本次输入" },
  { kind: "group_task", label: "群待办", hint: "拟定事项，预览后发布" },
  { kind: "group_plan", label: "共同计划", hint: "目标、阶段和任务" },
  { kind: "group_schedule", label: "日程安排", hint: "相关成员全部同意" },
  { kind: "group_reminder", label: "群提醒", hint: "共同安排或提醒自己" },
];

const STATUS: Record<string, string> = { queued: "排队中", reviewing: "主 Agent 评审中", needs_clarification: "需要补充", voting: "等待投票", approved: "已通过", executing: "执行中", completed: "已完成", failed: "暂不可用", withdrawn: "已撤回", expired: "已过期", rejected: "未通过" };

type Props=Readonly<{visible:boolean;spaceId:string;repository:ChatRepository;onClose():void;onPublished():void}>;
export function AgentWorkbench(props:Props){const{profile}=useSession();return profile?<OwnedAgentWorkbench key={`${profile.id}:${props.spaceId}`} {...props} ownerId={profile.id}/>:null;}
function OwnedAgentWorkbench({ visible, spaceId, repository, onClose, onPublished,ownerId }:Props&{ownerId:string}) {
  const { styles, colors } = useStyles();
  const insets = useSafeAreaInsets();
  const [backgroundOpen,setBackgroundOpen]=useState(false);
  const [requests, setRequests] = useState<readonly AgentRequest[]>([]);
  const [kind, setKind] = useState<AgentRequestKind>("read_summary");
  const [text, setText] = useState("请总结最近的群聊，区分已确认和待确认事项");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [workDraft,setWorkDraft]=useState<WorkInput|null>(null),[detailId,setDetailId]=useState<string|null>(null),[chooseReminder,setChooseReminder]=useState(false),[ownReminder,setOwnReminder]=useState(false),[previewSource,setPreviewSource]=useState<string|null>(null),[spaceName,setSpaceName]=useState("当前群");
  const prepared=useRef<{content:string;requestId:string}|null>(null);
  useEffect(()=>{let active=true;void repository.getSpaceName(spaceId).then(name=>{if(active)setSpaceName(name);}).catch(()=>{});return()=>{active=false;};},[repository,spaceId]);
  const openWork=(action:AgentRequestKind)=>{setChooseReminder(false);setWorkDraft({space_id:spaceId,kind:action==="group_plan"?"goal":"task",title:text.trim().slice(0,200),description:text.trim(),due_at:null,approval:action==="group_schedule"||action==="group_reminder"?"all":"none"});};
  const load = useCallback(async () => { try { setRequests(await repository.listAgentRequests(spaceId)); } catch (reason) { setError(reason instanceof Error ? reason.message : "共享面板加载失败"); } }, [repository, spaceId]);
  useEffect(() => { if (visible) void load(); }, [load, visible]);
  useEffect(() => { if (!visible) return; return repository.subscribe(spaceId, () => void load()); }, [load, repository, spaceId, visible]);
  const submit = async () => {
    if (!text.trim() || busy) return;
    if(kind==="group_task"||kind==="group_plan"||kind==="group_schedule"){openWork(kind);return;}
    if(kind==="group_reminder"){setChooseReminder(true);return;}
    setBusy(true); setError(null);
    try {
      const content=text.trim();
      if(kind==="delegated_message"){
        if(prepared.current?.content!==content)prepared.current={content,requestId:createRequestId()};
        const result=await invokeWork<{source_message_id:string}>("steward-actions",{action:"prepare",space_id:spaceId,exact_content:content,request_id:prepared.current.requestId});setPreviewSource(result.source_message_id);
      }else{
        await repository.submitAgentRequest({ spaceId, origin: "space_panel", kind, text:content, exactContent:null, idempotencyKey: createRequestId() });
        setText(current=>current.trim()===content?"":current); await load(); onPublished();
      }
    } catch (reason) { const message=reason instanceof Error?reason.message:"请求提交失败";setError(message==="steward_pet_required"?"请先在异宠页面确认你的异宠，再使用代发。":/not_space_member|forbidden/.test(message)?"当前已无权操作这个群。":message); }
    finally { setBusy(false); }
  };
  const vote = async (proposalId: string, decision: "approve" | "reject") => { setBusy(true); try { await repository.voteAgentProposal(proposalId, decision); await load(); onPublished(); } catch (reason) { setError(reason instanceof Error ? reason.message : "投票失败"); } finally { setBusy(false); } };
  const withdraw = async (requestId: string) => { setBusy(true); try { await repository.withdrawAgentRequest(requestId); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "撤回失败"); } finally { setBusy(false); } };

  const submitLabel=kind==="delegated_message"?"预览代发原文":kind==="read_summary"||kind==="read_query"?"提交给主 Agent":kind==="group_reminder"?"选择提醒方式":"继续编辑群事项";
  return <><Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardScreen style={styles.backdrop}><Pressable style={StyleSheet.absoluteFill} onPress={onClose} /><View style={[styles.panel, { paddingTop: insets.top + spacing.md, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <ChatBackgroundSurface threadKey={`agent:${spaceId}`} style={{flex:1,minHeight:0,padding:12,borderRadius:12}}><KeyboardScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: spacing.md }}>
      <View style={styles.head}><View style={{ flex: 1 }}><Text style={styles.title}>空间主 Agent · {spaceName}</Text><Text style={styles.note}>查询当前群消息；安排在事项里编辑、确认和跟进，代发先预览再发布。</Text></View><Pressable accessibilityRole="button" accessibilityLabel="设置主 Agent 背景" style={{minWidth:48,minHeight:48,alignItems:"center"}} onPress={()=>setBackgroundOpen(true)}><Icon name="image" color={colors.text}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel="关闭主 Agent" onPress={onClose}><Text style={styles.close}>×</Text></Pressable></View>
      <View style={styles.kinds}>{KINDS.map((item) => <Pressable key={item.kind} onPress={() => { setKind(item.kind); if (item.kind === "read_summary") setText("请总结最近的群聊，区分已确认和待确认事项"); else setText(""); }} style={[styles.kind, kind === item.kind && styles.kindActive]}><Text style={[styles.kindLabel, kind === item.kind && styles.kindLabelActive]}>{item.label}</Text><Text style={styles.kindHint}>{item.hint}</Text></Pressable>)}</View>

      {previewSource?<StewardActionCard key={`workbench-preview:${previewSource}`} sourceMessageId={previewSource}/>:null}
      {chooseReminder?<View style={{gap:10}}><Text style={styles.note}>先选择这次需要。共同安排要由相关成员同意；自己的提醒只通知你本人。</Text><AppButton label="拟定共同安排" onPress={()=>openWork("group_reminder")}/><AppButton label="只提醒我自己" onPress={()=>{setChooseReminder(false);setOwnReminder(true);}}/><AppButton label="返回编辑" variant="quiet" onPress={()=>setChooseReminder(false)}/></View>:null}
      <Text style={styles.section}>查询和历史共享记录</Text>
      <Text style={styles.note}>历史提案继续保留，新安排的进度以事项详情为准。</Text>
      {!requests.length ? <Text style={styles.empty}>还没有成员请求。</Text> : null}
      {requests.map((item) => <View key={item.id} style={styles.request}>
        <View style={styles.requestHead}><Text style={styles.requestKind}>{KINDS.find((candidate) => candidate.kind === item.kind)?.label ?? item.kind}</Text><Text style={styles.status}>{STATUS[item.status] ?? item.status}</Text></View>
        <Text style={styles.requestInput}>{item.userInput}</Text>{item.resultText ? <Text style={styles.result}>{item.resultText}</Text> : null}{item.reviewReason ? <Text style={styles.error}>{item.reviewReason}</Text> : null}
        {item.proposal?.status === "voting" ? <View style={styles.voteRow}><Text style={styles.voteCount}>赞成 {item.proposal.votes.filter((voteItem) => voteItem.decision === "approve").length} / 至少 {item.proposal.requiredApprovals}{item.proposal.affectedUserIds.length ? "，且被安排成员需全部同意" : ""}</Text><Pressable onPress={() => void vote(item.proposal!.id, "approve")}><Text style={styles.approve}>赞成</Text></Pressable><Pressable onPress={() => void vote(item.proposal!.id, "reject")}><Text style={styles.reject}>拒绝</Text></Pressable></View> : null}
        {!['completed', 'executing', 'withdrawn', 'expired', 'rejected'].includes(item.status) ? <Pressable onPress={() => void withdraw(item.id)}><Text style={styles.withdraw}>撤回请求</Text></Pressable> : null}
      </View>)}
      </KeyboardScrollView></ChatBackgroundSurface>
      <KeyboardTextInput accessibilityLabel="主 Agent 请求内容" value={text} onChangeText={setText} multiline maxLength={kind==="delegated_message"||kind==="group_reminder"?3800:4000} placeholder={kind === "delegated_message" ? "输入需要逐字代发的原文；下一步先预览" : "写下内容，下一步继续编辑"} placeholderTextColor={colors.textMuted} style={styles.input} />
      {error ? <Text style={styles.error}>{error}</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel={submitLabel} disabled={busy || !text.trim()} onPress={() => void submit()} style={[styles.submit, (busy || !text.trim()) && styles.disabled]}>{busy ? <ActivityIndicator color={colors.textDark} /> : <Text style={styles.submitText}>{submitLabel}</Text>}</Pressable>
    <ChatBackgroundEditor visible={backgroundOpen} onClose={()=>setBackgroundOpen(false)} threadKey={`agent:${spaceId}`}/></View></KeyboardScreen>
  </Modal>
  {visible&&workDraft?<WorkEditor ownerId={ownerId} initial={workDraft} onClose={()=>setWorkDraft(null)} onSaved={item=>{setWorkDraft(null);setDetailId(item.id);}}/>:null}
  {visible&&detailId?<WorkItemDetailSheet ownerId={ownerId} itemId={detailId} onClose={()=>setDetailId(null)} onChanged={onPublished}/>:null}
  {visible&&ownReminder?<Modal visible transparent animationType="slide" onRequestClose={()=>setOwnReminder(false)}><KeyboardScreen style={styles.backdrop}><View style={styles.panel}><KeyboardScrollView contentContainerStyle={{gap:12}}><Text style={styles.title}>只提醒我自己 · {spaceName}</Text><Text style={styles.note}>这条私人提醒不会发到群里，也不会替其他成员设置提醒。</Text><ReminderEditor initialTitle={`【${spaceName}】${text.trim()}`} /><AppButton label="返回群助手" variant="quiet" onPress={()=>setOwnReminder(false)}/></KeyboardScrollView></View></KeyboardScreen></Modal>:null}
  </>;
}

const useStyles = createThemedStyles((colors, theme) => ({
  backdrop: { flex: 1, backgroundColor: theme.overlay, alignItems: "flex-end" }, panel: { width: "100%", maxWidth: 680, height: "100%", backgroundColor: colors.canvasRaised, padding: spacing.lg, gap: spacing.md }, head: { flexDirection: "row", gap: 8 }, title: { color: colors.text, fontSize: 18, fontWeight: "600" }, note: { color: colors.textMuted, lineHeight: 19, marginTop: 4 }, close: { color: colors.textMuted, fontSize: 28, padding: 6 },
  kinds: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, kind: { minWidth: 98, flexGrow: 1, borderRadius: radii.md, backgroundColor: colors.surface, padding: 9, borderWidth: 1, borderColor: "transparent" }, kindActive: { borderColor: colors.mint, backgroundColor: colors.mintDeep }, kindLabel: { color: colors.text, fontWeight: "700", fontSize: 12 }, kindLabelActive: { color: colors.mint }, kindHint: { color: colors.textMuted, fontSize: 9, marginTop: 3 },
  input: { minHeight: 82, maxHeight: 150, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.text, padding: 12, textAlignVertical: "top" }, submit: { minHeight: 46, backgroundColor: colors.mint, borderRadius: radii.md, alignItems: "center", justifyContent: "center" }, submitText: { color: theme.onPrimary, fontWeight: "700" }, disabled: { opacity: .4 }, error: { color: theme.danger, fontSize: 11 }, section: { color: colors.text, fontWeight: "700", fontSize: 16 }, list: { flex: 1 }, empty: { color: colors.textMuted, textAlign: "center", padding: 20 }, request: { backgroundColor: colors.surface, borderRadius: radii.md, padding: 12, gap: 7, marginBottom: 8 }, requestHead: { flexDirection: "row", justifyContent: "space-between", gap: 8 }, requestKind: { color: colors.lavender, fontWeight: "700", fontSize: 11 }, status: { color: colors.mint, fontSize: 10 }, requestInput: { color: colors.text, lineHeight: 20 }, result: { color: colors.textMuted, lineHeight: 19, borderLeftWidth: 2, borderLeftColor: colors.mint, paddingLeft: 8 }, voteRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }, voteCount: { flex: 1, minWidth: 180, color: colors.textMuted, fontSize: 10 }, approve: { color: colors.mint, fontWeight: "700" }, reject: { color: theme.danger, fontWeight: "700" }, withdraw: { color: colors.textMuted, fontSize: 10, textDecorationLine: "underline" },
}));
