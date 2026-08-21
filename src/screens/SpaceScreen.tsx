import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AgentCard } from "../components/AgentCard";
import { DelegationCard } from "../components/DelegationCard";
import { MessageBubble } from "../components/MessageBubble";
import { PetCorner } from "../components/PetCorner";
import { getPetPauseGovernance } from "../domain/agentRuntime";
import { useAppState } from "../state/AppState";
import { colors, radii, spacing, typography } from "../theme/tokens";

const MEMBER_LABELS: Readonly<Record<string, string>> = {
  "owner-mei": "梅",
  "friend-lin": "林",
};

export function SpaceScreen() {
  const { state, dispatch } = useAppState();
  const activeSpace = state.spaces.find((space) => space.id === state.activeSpaceId) ?? state.spaces[0];
  const [draft, setDraft] = useState("");

  if (!activeSpace) {
    return <View style={styles.empty}><Text style={styles.emptyText}>还没有关系空间。</Text></View>;
  }

  const messages = state.messages.filter((message) => message.spaceId === activeSpace.id);
  const stories = state.petCornerStories.filter((story) => story.spaceId === activeSpace.id);
  const experiences = state.pet.experiences.filter((experience) => experience.id.includes(activeSpace.id));
  const delegations = state.delegatedActions.filter((action) => !action.spaceId || action.spaceId === activeSpace.id);
  const pendingCount = delegations.filter((action) => action.status === "pending_owner").length;
  const muted = activeSpace.locallyMutedPetIds.includes(state.pet.id);
  const governance = getPetPauseGovernance(activeSpace, state.pet.id);
  const currentMemberLabel = MEMBER_LABELS[state.currentUserId] ?? state.currentUserId;
  const currentVote = [...activeSpace.petGovernanceVotes].reverse().find(
    (vote) => vote.petId === state.pet.id && vote.voterId === state.currentUserId,
  );
  const currentUserIsPausing = currentVote?.decision === "pause";

  const send = () => {
    if (!draft.trim()) return;
    dispatch({
      type: "SEND_HUMAN_MESSAGE",
      spaceId: activeSpace.id,
      actorId: state.currentUserId,
      content: draft,
      occurredAt: new Date().toISOString(),
    });
    setDraft("");
  };

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>RELATIONSHIP SPACE / 隔离记忆舱</Text>
        <Text style={styles.display}>{activeSpace.name}</Text>
        <Text style={styles.lede}>{activeSpace.memberIds.length} 位成员 · 当前身份：{currentMemberLabel} · 人类聊天始终独立于 Agent 控制</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.spaceTabs}>
        {state.spaces.map((space) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`选择空间：${space.name}`}
            key={space.id}
            onPress={() => dispatch({ type: "SET_ACTIVE_SPACE", spaceId: space.id })}
            style={[styles.spaceTab, space.id === activeSpace.id && styles.spaceTabActive]}
          >
            <Text style={[styles.spaceTabText, space.id === activeSpace.id && styles.spaceTabTextActive]}>{space.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.grid}>
        <View style={styles.mainColumn}>
          <View style={styles.timelineCard}>
            <Text style={styles.sectionTitle}>空间消息</Text>
            <Text style={styles.sectionNote}>三类内容使用独立身份、来源与叙述边界。</Text>
            <View style={styles.timeline}>
              {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
            </View>
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="消息内容"
                placeholder={`给${activeSpace.name}发消息`}
                placeholderTextColor={colors.textMuted}
                value={draft}
                onChangeText={setDraft}
                style={styles.input}
              />
              <Pressable accessibilityRole="button" accessibilityLabel="发送消息" onPress={send} style={styles.send}><Text style={styles.sendText}>发送</Text></Pressable>
            </View>
          </View>

          <AgentCard
            pendingCount={pendingCount}
            onSummarize={() => dispatch({ type: "RUN_SPACE_SUMMARY", spaceId: activeSpace.id, occurredAt: new Date().toISOString() })}
          />

          <PetCorner
            petName={state.pet.name}
            ownerId={state.pet.ownerId}
            spaceName={activeSpace.name}
            stories={stories}
            experiences={experiences}
            onCare={() => dispatch({ type: "CARE_FOR_PET", spaceId: activeSpace.id, byUserId: state.currentUserId, care: "梳理触角", occurredAt: new Date().toISOString() })}
            onInteract={() => dispatch({ type: "CARE_FOR_PET", spaceId: activeSpace.id, byUserId: state.currentUserId, care: "击掌互动", occurredAt: new Date().toISOString() })}
          />
        </View>

        <View style={styles.sideColumn}>
          <View style={styles.actionCard}>
            <Text style={styles.sectionTitle}>异宠协助</Text>
            <Text style={styles.sectionNote}>查询只使用本空间记忆；代理先经过风险策略。</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`问${state.pet.name}发生了什么`} onPress={() => dispatch({ type: "QUERY_PET", spaceId: activeSpace.id, requesterId: state.currentUserId, occurredAt: new Date().toISOString() })} style={styles.softButton}><Text style={styles.softButtonText}>问{state.pet.name}发生了什么</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="创建暂定提醒" onPress={() => dispatch({ type: "REQUEST_DELEGATION", request: { kind: "tentative_reminder", spaceId: activeSpace.id, summary: "周末接力游戏暂定提醒" } })} style={styles.softButton}><Text style={styles.softButtonText}>创建暂定提醒</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="请求真实见面" onPress={() => dispatch({ type: "REQUEST_DELEGATION", request: { kind: "meetup", spaceId: activeSpace.id, summary: "替主人答应周末见面" } })} style={styles.riskButton}><Text style={styles.riskButtonText}>请求真实见面（需策略检查）</Text></Pressable>
            <Text style={styles.riskNote}>阻断原因：真实见面、长期计划、情感承诺与关系变化会形成主人承诺；位置、健康和敏感信息需本人再次授权；消费与财务不能由异宠决定。</Text>
          </View>

          {delegations.length ? (
            <View style={styles.delegationList}>
              <Text style={styles.sectionTitle}>代理事项</Text>
              {delegations.map((action, index) => (
                <DelegationCard
                  key={action.id ?? `${action.kind}-${index}`}
                  action={action}
                  onConfirm={() => action.id && dispatch({ type: "CONFIRM_ACTION", actionId: action.id })}
                  onRevoke={() => action.id && dispatch({ type: "REVOKE_ACTION", actionId: action.id })}
                />
              ))}
            </View>
          ) : null}

          <View style={styles.governanceCard}>
            <Text style={styles.sectionTitle}>异宠发言治理</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={muted ? `恢复${state.pet.name}声音` : `本地静音${state.pet.name}`} onPress={() => dispatch({ type: "TOGGLE_LOCAL_MUTE", spaceId: activeSpace.id, voterId: state.currentUserId })} style={styles.softButton}><Text style={styles.softButtonText}>{muted ? `恢复${state.pet.name}声音` : `本地静音${state.pet.name}`}</Text></Pressable>
            <Text style={styles.voteStatus}>{governance.paused ? "已按多数暂停异宠主动发言" : `暂停票 ${governance.pauses}/${governance.required} · 尚未达到多数`}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${currentMemberLabel}投票${currentUserIsPausing ? "恢复" : "暂停"}`}
              onPress={() => dispatch({ type: "CAST_PET_GOVERNANCE_VOTE", spaceId: activeSpace.id, voterId: state.currentUserId, decision: currentUserIsPausing ? "resume" : "pause" })}
              style={styles.voteButton}
            >
              <Text style={styles.voteButtonText}>{currentMemberLabel}：{currentUserIsPausing ? "恢复主动发言" : "同意暂停"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 980, alignSelf: "center", paddingTop: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.md },
  hero: { marginHorizontal: spacing.lg },
  kicker: { color: colors.coral, fontSize: typography.eyebrow, fontWeight: "800", letterSpacing: 1.4 },
  display: { marginTop: spacing.xs, color: colors.text, fontSize: typography.display, fontWeight: "900" },
  lede: { marginTop: spacing.xs, color: colors.textMuted, lineHeight: 21 },
  spaceTabs: { gap: spacing.sm, paddingHorizontal: spacing.md },
  spaceTab: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderColor: colors.line, borderWidth: 1, borderRadius: radii.pill },
  spaceTabActive: { backgroundColor: colors.lavenderSoft },
  spaceTabText: { color: colors.textMuted, fontWeight: "800" },
  spaceTabTextActive: { color: colors.textDark },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginHorizontal: spacing.md },
  mainColumn: { flexGrow: 2, flexShrink: 1, flexBasis: 520, minWidth: 280, gap: spacing.md },
  sideColumn: { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 280, gap: spacing.md },
  timelineCard: { padding: spacing.lg, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radii.lg },
  sectionTitle: { color: colors.text, fontSize: typography.title, fontWeight: "900" },
  sectionNote: { marginTop: spacing.xs, color: colors.textMuted, lineHeight: 20 },
  timeline: { marginTop: spacing.md, gap: spacing.sm },
  composer: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  input: { flex: 1, minHeight: 46, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.canvasRaised, borderColor: colors.line, borderWidth: 1, borderRadius: radii.sm },
  send: { justifyContent: "center", paddingHorizontal: spacing.md, backgroundColor: colors.coral, borderRadius: radii.sm },
  sendText: { color: colors.textDark, fontWeight: "900" },
  actionCard: { padding: spacing.lg, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radii.lg, gap: spacing.sm },
  softButton: { alignItems: "center", padding: spacing.sm, backgroundColor: colors.lavenderSoft, borderRadius: radii.sm },
  softButtonText: { color: colors.textDark, fontWeight: "900" },
  riskButton: { alignItems: "center", padding: spacing.sm, borderColor: colors.coral, borderWidth: 1, borderRadius: radii.sm },
  riskButtonText: { color: colors.coralSoft, fontWeight: "900" },
  riskNote: { color: colors.textMuted, fontSize: 11, lineHeight: 17 },
  delegationList: { gap: spacing.sm },
  governanceCard: { padding: spacing.lg, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radii.lg, gap: spacing.sm },
  voteStatus: { color: colors.mint, fontWeight: "800", lineHeight: 21 },
  voteButton: { padding: spacing.sm, borderColor: colors.line, borderWidth: 1, borderRadius: radii.sm },
  voteButtonText: { color: colors.text, fontWeight: "800" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { color: colors.text },
});
