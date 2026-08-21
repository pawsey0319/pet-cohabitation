import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AppPet } from "../state/AppState";
import { useAppState } from "../state/AppState";
import {
  selectAccessibleSpaces,
  selectVisibleDelegatedActions,
  selectVisiblePetCornerStories,
} from "../state/selectors";
import type { DelegatedAction, PetStatus, RelationshipSpace } from "../domain/types";
import { AgentBadge } from "../components/AgentBadge";
import { GlassCard } from "../components/GlassCard";
import { PetAvatar } from "../components/PetAvatar";
import { colors, radii, spacing, typography } from "../theme/tokens";

function relationshipLabel(space: RelationshipSpace): string {
  if (space.kind === "lover_pair") return "亲密搭档";
  if (space.kind === "friend_circle") return "朋友小圈";
  return "两人空间";
}

function pendingSummary(action: DelegatedAction, pet: AppPet): string {
  return action.summary?.trim() || `${pet.name}准备执行一项代办，正在等你确认。`;
}

const PET_STATUS_LABELS = {
  waiting_warmly: "温暖等你",
  exploring_spaces: "正在串门",
} satisfies Readonly<Record<PetStatus, string>>;

export function PetStatusPill({ status }: Readonly<{ status: PetStatus }>) {
  return (
    <View style={styles.livePill}>
      <View style={styles.liveDot} />
      <Text style={styles.liveText}>{PET_STATUS_LABELS[status]}</Text>
    </View>
  );
}

export function HomeScreen({ onOpenSpace }: Readonly<{ onOpenSpace?: (spaceId: string) => void }>) {
  const { state } = useAppState();
  const spaces = selectAccessibleSpaces(state);
  const pendingActions = selectVisibleDelegatedActions(state).filter(
    (action) => action.status === "pending_owner",
  );
  const visibleStories = selectVisiblePetCornerStories(state);
  const recentStory = visibleStories[visibleStories.length - 1];

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.heroCopy}>
        <Text style={styles.kicker}>CO-LIVING / 今日共生</Text>
        <Text style={styles.display}>你们的关系，{state.pet.name}也在认真生活。</Text>
        <Text style={styles.lede}>同一只异宠穿过每个关系空间，记住相处，也把重要的事带回你面前。</Text>
      </View>

      <View style={styles.coreGrid}>
        <GlassCard accent="coral" style={styles.petCard}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.eyebrow}>LIFELONG PET</Text>
              <Text style={styles.sectionTitle}>今天的异宠</Text>
            </View>
            <PetStatusPill status={state.pet.status} />
          </View>
          <View style={styles.petBody}>
            <PetAvatar pet={state.pet} />
            <View style={styles.petCopy}>
              <Text style={styles.petName}>{state.pet.name}</Text>
              <Text style={styles.petIdentity}>
                {state.pet.identityAnchors.eyes} · {state.pet.identityAnchors.voice}声线
              </Text>
              <Text style={styles.bodyText}>
                {recentStory?.content || "正在安静地等待下一次共同空间互动。"}
              </Text>
            </View>
          </View>
        </GlassCard>

        <GlassCard accent="lavender" style={styles.spaceCard}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.eyebrow}>SHARED CONTEXT</Text>
              <Text style={styles.sectionTitle}>关系空间</Text>
            </View>
            <Text style={styles.count}>{spaces.length}</Text>
          </View>
          <View style={styles.spaceList}>
            {spaces.map((space) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`进入空间：${space.name}`}
                key={space.id}
                onPress={() => onOpenSpace?.(space.id)}
                style={({ pressed }) => [styles.spaceRow, pressed && styles.spaceRowPressed]}
              >
                <View style={styles.spaceMonogram}>
                  <Text style={styles.spaceMonogramText}>{space.name.slice(0, 1)}</Text>
                </View>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>{space.name}</Text>
                  <Text style={styles.rowMeta}>
                    {relationshipLabel(space)} · {space.memberIds.length} 位成员
                  </Text>
                </View>
                <Text style={styles.arrow}>↗</Text>
              </Pressable>
            ))}
            {spaces.length === 0 ? (
              <Text style={styles.emptyText}>当前身份还没有可访问的关系空间。</Text>
            ) : null}
          </View>
          <Text style={styles.cardFootnote}>{state.pet.name}只在被允许的空间里看见共同语境。</Text>
        </GlassCard>
      </View>

      <View style={styles.supportGrid}>
        <GlassCard accent="mint" style={styles.supportCard}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.eyebrow}>OWNER GATE</Text>
              <Text style={styles.sectionTitle}>待你确认</Text>
            </View>
            <Text style={styles.pendingCount}>{pendingActions.length}</Text>
          </View>
          <AgentBadge label="异宠代办" />
          {pendingActions.length ? (
            <View style={styles.actionList}>
              {pendingActions.slice(0, 2).map((action, index) => (
                <View key={action.id ?? `${action.kind}-${index}`} style={styles.actionRow}>
                  <View style={styles.actionIndex}>
                    <Text style={styles.actionIndexText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.actionText}>{pendingSummary(action, state.pet)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>{state.pet.name}暂时没有需要你确认的事。</Text>
          )}
          <Text style={styles.cardFootnote}>跨出聊天前，每一步都由你决定。</Text>
        </GlassCard>

        <GlassCard accent="coral" style={[styles.supportCard, styles.ritualCard]}>
          <Text style={styles.ritualTime}>21:30</Text>
          <Text style={styles.sectionTitle}>今晚碰个面</Text>
          <Text style={styles.ritualPrompt}>留十分钟，问问彼此：今天哪一刻最想被看见？</Text>
          <View style={styles.ritualFooter}>
            <View style={styles.ritualFaces}>
              <View style={[styles.face, styles.faceFront]}>
                <Text style={styles.faceText}>你</Text>
              </View>
              <View style={[styles.face, styles.faceBack]}>
                <Text style={styles.faceText}>伴</Text>
              </View>
            </View>
            <Text style={styles.ritualMeta}>关系仪式 · 仅提醒</Text>
          </View>
        </GlassCard>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  heroCopy: {
    marginHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  kicker: {
    color: colors.coral,
    fontSize: typography.eyebrow,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  display: {
    maxWidth: 670,
    marginTop: spacing.sm,
    color: colors.text,
    fontSize: typography.display,
    lineHeight: 43,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  lede: {
    maxWidth: 640,
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 24,
  },
  coreGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginHorizontal: spacing.md,
  },
  petCard: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 440,
    minWidth: 280,
    maxWidth: "100%",
    backgroundColor: colors.surfaceSoft,
  },
  spaceCard: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 360,
    minWidth: 280,
    maxWidth: "100%",
  },
  supportGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginHorizontal: spacing.md,
  },
  supportCard: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 360,
    minWidth: 280,
    maxWidth: "100%",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  eyebrow: {
    marginBottom: spacing.xs,
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.title,
    lineHeight: 31,
    fontWeight: "800",
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: "rgba(125, 226, 196, 0.1)",
    borderRadius: radii.pill,
  },
  liveDot: {
    width: 7,
    height: 7,
    backgroundColor: colors.mint,
    borderRadius: radii.pill,
  },
  liveText: {
    color: colors.mint,
    fontSize: typography.eyebrow,
    fontWeight: "700",
  },
  petBody: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  petCopy: {
    flex: 1,
    minWidth: 150,
  },
  petName: {
    color: colors.coralSoft,
    fontSize: 30,
    fontWeight: "900",
  },
  petIdentity: {
    marginTop: spacing.xs,
    color: colors.lavenderSoft,
    fontSize: 13,
    fontWeight: "700",
  },
  bodyText: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 23,
  },
  count: {
    color: colors.lavender,
    fontSize: 34,
    lineHeight: 36,
    fontWeight: "300",
  },
  spaceList: {
    gap: spacing.sm,
  },
  spaceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: "rgba(230, 225, 255, 0.06)",
    borderRadius: radii.md,
  },
  spaceRowPressed: {
    opacity: 0.72,
  },
  spaceMonogram: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.lavenderSoft,
    borderRadius: radii.sm,
  },
  spaceMonogramText: {
    color: colors.textDark,
    fontSize: typography.bodyLarge,
    fontWeight: "900",
  },
  rowCopy: {
    flex: 1,
  },
  rowTitle: {
    color: colors.text,
    fontSize: typography.bodyLarge,
    fontWeight: "800",
  },
  rowMeta: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: typography.eyebrow,
  },
  arrow: {
    color: colors.lavender,
    fontSize: 20,
  },
  cardFootnote: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: typography.eyebrow,
    lineHeight: 18,
  },
  pendingCount: {
    minWidth: 38,
    height: 38,
    textAlign: "center",
    textAlignVertical: "center",
    color: colors.textDark,
    backgroundColor: colors.mint,
    borderRadius: radii.pill,
    fontSize: typography.bodyLarge,
    fontWeight: "900",
  },
  actionList: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  actionIndex: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
    backgroundColor: colors.mint,
  },
  actionIndexText: {
    color: colors.textDark,
    fontWeight: "900",
  },
  actionText: {
    flex: 1,
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 21,
  },
  emptyText: {
    marginTop: spacing.md,
    color: colors.text,
    fontSize: typography.bodyLarge,
    lineHeight: 25,
    fontWeight: "700",
  },
  ritualCard: {
    backgroundColor: "#49304D",
  },
  ritualTime: {
    color: colors.coralSoft,
    fontSize: 44,
    lineHeight: 48,
    fontWeight: "300",
    letterSpacing: -1.5,
  },
  ritualPrompt: {
    maxWidth: 400,
    marginTop: spacing.sm,
    color: colors.text,
    fontSize: typography.bodyLarge,
    lineHeight: 26,
  },
  ritualFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
  },
  ritualFaces: {
    flexDirection: "row",
    width: 64,
  },
  face: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: "#49304D",
  },
  faceFront: {
    zIndex: 1,
    backgroundColor: colors.coral,
  },
  faceBack: {
    marginLeft: -8,
    backgroundColor: colors.lavender,
  },
  faceText: {
    color: colors.textDark,
    fontSize: typography.eyebrow,
    fontWeight: "900",
  },
  ritualMeta: {
    color: colors.coralSoft,
    fontSize: typography.eyebrow,
    fontWeight: "700",
  },
});
