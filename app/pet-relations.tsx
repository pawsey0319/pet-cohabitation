import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { createChatRepository } from "../src/data/chatRepository";
import type { AppProfile, ChatSpace } from "../src/data/types";
import { PetFeatureScreen } from "../src/navigation/PetFeatureScreen";
import { OwnedPetGate, useOwnedPet } from "../src/navigation/useOwnedPet";
import { usePersonality } from "../src/personality/usePersonality";
import { RelationshipConsentPanel, relationshipMemberName } from "../src/personality/RelationshipConsentPanel";
import type { Relationship, RelationshipConsent } from "../src/personality/client";
import { AppButton, Surface } from "../src/ui/common";
import { useAppTheme } from "../src/theme/ThemeProvider";
import { KeyboardScreen, KeyboardTextInput } from "../src/components/KeyboardLayout";
import { workRouteParam } from "../src/work/routeParams";

function GroupRelations({ owner, petId, spaceId }: { owner: string; petId: string; spaceId: string }) {
  const { theme } = useAppTheme(); const router = useRouter(); const { data, busy, error, load, mutate } = usePersonality(owner, spaceId);
  const [members, setMembers] = useState<RelationshipConsent["members"]>([]), [editing, setEditing] = useState<{ relation: Relationship; forget: boolean } | null>(null), [correction, setCorrection] = useState("");
  const name = (id: string) => members.find(member => member.user_id === id) ? relationshipMemberName(members.find(member => member.user_id === id)!) : id === owner ? "我" : "原群成员";
  return <>
    <RelationshipConsentPanel ownerId={owner} petId={petId} spaceId={spaceId} onLoaded={value => setMembers(value.members)} />
    {error ? <Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text> : null}
    {!data && !error ? <ActivityIndicator color={theme.accent} /> : null}
    {data?.relationships.length === 0 ? <Text style={{ color: theme.muted, lineHeight: 24 }}>这只异宠还没有形成可查看的群关系理解。没有记录不代表这些关系不存在。</Text> : null}
    {data?.relationships.map(relation => <Surface key={relation.id} style={{ gap: 10 }}>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: "600" }}>{name(relation.subject_id)} · {name(relation.object_id)}</Text>
      <Text style={{ color: theme.muted }}>{new Date(relation.source_date).toLocaleDateString("zh-CN")} · {relation.state === "pending" || relation.assertion === "uncertain" ? "待确认" : relation.state === "reported" || relation.assertion === "reported" ? "成员转述" : relation.state === "active" ? "本人明确表达" : "已停用"}</Text>
      <Text style={{ color: theme.text, lineHeight: 24 }}>{relation.relation ?? "这项理解已停用，不再作为关系依据。"}</Text>
      {relation.quote ? <Text style={{ color: theme.muted, lineHeight: 24 }}>{name(relation.speaker_id)}的原话：{relation.quote}</Text> : null}
      {relation.owner_correction ? <Text style={{ color: theme.muted }}>你的纠正：{relation.owner_correction}</Text> : null}
      {["active", "reported", "pending"].includes(relation.state) ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {relation.source_id ? <AppButton label="查看原消息" variant="quiet" onPress={() => router.push({ pathname: "/chat/[spaceId]", params: { spaceId, messageId: relation.source_id } } as Href)} /> : null}
        <AppButton label="这不准确" variant="quiet" disabled={busy} onPress={() => { setCorrection(""); setEditing({ relation, forget: false }); }} />
        <AppButton label="忘记这份理解" variant="quiet" disabled={busy} onPress={() => setEditing({ relation, forget: true })} />
      </View> : null}
    </Surface>)}
    {data && data.relationships.length >= (data.page + 1) * data.page_size ? <AppButton label="加载更早理解" variant="quiet" disabled={busy} onPress={() => void load(data.page + 1)} /> : null}
    <AppButton label="刷新关系理解" variant="quiet" disabled={busy} onPress={() => void load()} />
    <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => !busy && setEditing(null)}><KeyboardScreen style={{ flex: 1, backgroundColor: theme.overlay, justifyContent: "center", padding: 20 }}><Surface style={{ gap: 12 }}>
      <Text style={{ color: theme.text, fontSize: 18, fontWeight: "600" }}>{editing?.forget ? "忘记这份理解？" : "纠正关系理解"}</Text><Text style={{ color: theme.muted, lineHeight: 24 }}>这份依据将停止使用。你的纠正不会自动成为所有成员共同认可的新事实，也不会删除原群消息。</Text>
      {!editing?.forget ? <KeyboardTextInput accessibilityLabel="关系纠正说明" value={correction} onChangeText={setCorrection} placeholder="可补充哪里理解错了（选填）" placeholderTextColor={theme.muted} maxLength={200} multiline style={{ color: theme.text, minHeight: 100, padding: 12, borderWidth: 1, borderColor: theme.line, borderRadius: 8 }} /> : null}
      {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}<AppButton label="确认停用" disabled={busy} onPress={() => { if (editing) void mutate(editing.forget ? "forget_relationship" : "correct_relationship", { relationship_id: editing.relation.id, ...(!editing.forget && correction.trim() ? { correction: correction.trim() } : {}) }).then(done => { if (done) setEditing(null); }); }} /><AppButton label="取消" variant="quiet" disabled={busy} onPress={() => setEditing(null)} />
    </Surface></KeyboardScreen></Modal>
  </>;
}
function RelationsContent({ profile, petId, initialSpace }: { profile: AppProfile; petId: string; initialSpace?: string }) {
  const { theme } = useAppTheme(); const repository = useMemo(() => createChatRepository(profile), [profile]);
  const [spaces, setSpaces] = useState<readonly ChatSpace[] | null>(null), [error, setError] = useState(""), [selected, setSelected] = useState(initialSpace ?? "");
  useEffect(() => { let active = true; void repository.listSpaces(profile.id).then(value => { if (active) { setSpaces(value); setSelected(current => current || value[0]?.id || ""); } }).catch(() => { if (active) setError("群列表暂时无法加载，请返回后重试。"); }); return () => { active = false; }; }, [repository, profile.id]);
  return <>
    {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
    {spaces === null && !error ? <ActivityIndicator color={theme.accent} /> : null}
    {spaces?.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{spaces.map(space => <AppButton key={space.id} label={space.name} variant={selected === space.id ? "primary" : "secondary"} onPress={() => setSelected(space.id)} />)}</View> : spaces ? <Text style={{ color: theme.muted }}>加入群聊后，可以在这里查看异宠分别形成的理解。</Text> : null}
    {selected && spaces?.some(space => space.id === selected) ? <GroupRelations key={`${profile.id}:${selected}`} owner={profile.id} petId={petId} spaceId={selected} /> : selected && spaces ? <Text style={{ color: theme.muted }}>当前不在这个群，相关关系资料不可查看。</Text> : null}
  </>;
}
export default function PetRelationsRoute() {
  const state = useOwnedPet(); const { theme } = useAppTheme(); const params = useLocalSearchParams<{ spaceId?: string | string[] }>();
  return <PetFeatureScreen title="群关系理解" description="这是你的异宠对各群的理解。主人身份始终来自账号绑定；关系理解保留原话，转述和待确认内容分开显示。"><OwnedPetGate state={state}>{state.profile && state.dashboard?.pet && !state.isLocalDemo ? <RelationsContent key={state.profile.id} profile={state.profile} petId={state.dashboard.pet.id} initialSpace={workRouteParam(params.spaceId)} /> : <Text style={{ color: theme.muted }}>登录真实账号后可以管理群关系理解与授权。</Text>}</OwnedPetGate></PetFeatureScreen>;
}
