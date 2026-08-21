import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { EvolutionSheet } from "../components/EvolutionSheet";
import { GlassCard } from "../components/GlassCard";
import { PetAvatar } from "../components/PetAvatar";
import { writeGrowthDiary } from "../domain/evolution";
import type { SpaceMemory } from "../domain/types";
import { useAppState, type PetPreferences } from "../state/AppState";
import {
  isCurrentUserPetOwner,
  selectAccessibleSpaces,
  selectVisiblePetMemories,
} from "../state/selectors";
import { colors, radii, spacing, typography } from "../theme/tokens";

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  chat: "聊天",
  life_seed: "生命种子",
};

const FREQUENCY_LABELS: Readonly<Record<PetPreferences["proactiveFrequency"], string>> = {
  daily: "日常",
  low: "低频",
  quiet: "安静",
};

function memoryDate(occurredAt: string): string {
  const date = new Date(occurredAt);
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
}

function MemoryCard({ memory, spaceName, editable = true, onEdit, onDelete }: Readonly<{
  memory: SpaceMemory;
  spaceName: string;
  editable?: boolean;
  onEdit?: (content: string) => void;
  onDelete?: () => void;
}>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);

  return (
    <View style={styles.memoryCard}>
      <Text style={styles.memoryScope}>{memory.spaceId === "global" ? "全局个人记忆" : `空间记忆 · ${spaceName}`}</Text>
      {editing ? (
        <>
          <TextInput placeholder="修改记忆内容" placeholderTextColor={colors.textMuted} value={draft} onChangeText={setDraft} style={styles.memoryInput} />
          <Pressable accessibilityRole="button" accessibilityLabel="保存记忆" onPress={() => { onEdit?.(draft); setEditing(false); }} style={styles.saveButton}><Text style={styles.saveText}>保存记忆</Text></Pressable>
        </>
      ) : <Text style={styles.memoryContent}>{memory.content}</Text>}
      <Text style={styles.memoryMeta}>来源：{SOURCE_LABELS[memory.source] ?? memory.source} · {memoryDate(memory.occurredAt)} · {memory.visibility === "owner_only" ? "仅主人" : "本空间成员"}</Text>
      {!editing && editable ? (
        <View style={styles.memoryActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={`编辑记忆：${memory.content}`} onPress={() => { setDraft(memory.content); setEditing(true); }}><Text style={styles.editText}>编辑</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`删除记忆：${memory.content}`} onPress={onDelete}><Text style={styles.deleteText}>删除</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function PetScreen() {
  const { state, dispatch } = useAppState();
  const ownerView = isCurrentUserPetOwner(state);
  const accessibleSpaces = selectAccessibleSpaces(state);
  const visibleMemories = selectVisiblePetMemories(state);
  const spacesById = new Map(accessibleSpaces.map((space) => [space.id, space.name]));
  const nextFrequency: Readonly<Record<PetPreferences["proactiveFrequency"], PetPreferences["proactiveFrequency"]>> = { daily: "low", low: "quiet", quiet: "daily" };
  const formLabel = state.evolutionEvents.length ? `成长形态 · ${state.evolutionEvents.length + 1}` : "初生共生体";
  const canProposeEvolution = state.pet.experiences.some(
    (experience) => !state.consumedEvolutionExperienceIds.includes(experience.id),
  );

  if (!ownerView) {
    return (
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>LIFELONG PET / 共同空间访客</Text>
          <Text style={styles.display}>公共照顾视图</Text>
          <Text style={styles.lede}>你可以查看共同空间中允许分享的照顾记录与普通记忆。</Text>
        </View>
        <View style={styles.grid}>
          <GlassCard accent="coral" style={styles.identityCard}>
            <View style={styles.avatarRow}>
              <PetAvatar pet={state.pet} size={150} />
              <View style={styles.identityCopy}>
                <Text style={styles.petName}>{state.pet.name}</Text>
                <Text style={styles.currentForm}>共同空间的异宠伙伴</Text>
                <Text style={styles.sectionNote}>进入共同空间后可照顾或询问{state.pet.name}。</Text>
              </View>
            </View>
          </GlassCard>
          <GlassCard accent="lavender" style={styles.controlCard}>
            <Text style={styles.sectionTitle}>主人专属生命档案已锁定</Text>
            <Text style={styles.sectionNote}>身份锚点、全局记忆、成长日记、进化与相处偏好只由主人查看和管理。</Text>
          </GlassCard>
        </View>
        <View style={styles.grid}>
          <View style={styles.column}>
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>共同空间记忆</Text>
              <Text style={styles.sectionNote}>这里只显示你所在空间中可向成员公开的普通记忆。</Text>
              <View style={styles.memoryList}>
                {visibleMemories.map((memory) => (
                  <MemoryCard
                    editable={false}
                    key={memory.id}
                    memory={memory}
                    spaceName={spacesById.get(memory.spaceId) ?? "共同空间"}
                  />
                ))}
                {visibleMemories.length === 0 ? <Text style={styles.empty}>暂无可分享的共同空间记忆。</Text> : null}
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>LIFELONG PET / 唯一身份</Text>
        <Text style={styles.display}>{state.pet.name}的生命档案</Text>
        <Text style={styles.lede}>不会死亡、退化或责怪你。离线时继续生活，重逢时带回故事。</Text>
      </View>

      <View style={styles.grid}>
        <GlassCard accent="coral" style={styles.identityCard}>
          <View style={styles.avatarRow}>
            <PetAvatar pet={state.pet} size={170} />
            <View style={styles.identityCopy}>
              <Text style={styles.petName}>{state.pet.name}</Text>
              <Text style={styles.currentForm}>当前形态 · {formLabel}</Text>
              <Text style={styles.seed}>生命种子 · {state.pet.lifeSeed}</Text>
            </View>
          </View>
          <Text style={styles.sectionTitle}>永久身份锚点</Text>
          <View style={styles.anchorWrap}>
            {[state.pet.identityAnchors.eyes, state.pet.identityAnchors.coreColor, `${state.pet.identityAnchors.voice}声线`, state.pet.identityAnchors.silhouette, state.pet.identityAnchors.signatureOrgan].map((anchor) => <Text key={anchor} style={styles.anchor}>{anchor}</Text>)}
          </View>
          <Text style={styles.traits}>已继承的抽象特征：{state.pet.abstractTraits.join("、")}</Text>
        </GlassCard>

        <GlassCard accent="mint" style={styles.controlCard}>
          <Text style={styles.sectionTitle}>相处节奏</Text>
          <Text style={styles.sectionNote}>控制提醒节奏，不改变{state.pet.name}接受或拒绝互动的自主性。</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`主动频率：${FREQUENCY_LABELS[state.petPreferences.proactiveFrequency]}`} onPress={() => dispatch({ type: "SET_PET_PROACTIVE_FREQUENCY", frequency: nextFrequency[state.petPreferences.proactiveFrequency] })} style={styles.controlButton}><Text style={styles.controlText}>主动频率：{FREQUENCY_LABELS[state.petPreferences.proactiveFrequency]}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`作息：${state.petPreferences.routine}`} onPress={() => dispatch({ type: "SET_PET_ROUTINE", routine: state.petPreferences.routine === "22:30–07:30" ? "23:30–08:00" : "22:30–07:30" })} style={styles.controlButton}><Text style={styles.controlText}>作息：{state.petPreferences.routine}</Text></Pressable>
        </GlassCard>
      </View>

      <View style={styles.grid}>
        <View style={styles.column}>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>叙事生命日记</Text>
            <Text style={styles.sectionNote}>成长由做过的事与共同生活书写。</Text>
            {state.pet.experiences.length === 0 && state.evolutionEvents.length === 0 ? <Text style={styles.empty}>第一篇故事正在发生。</Text> : null}
            {state.pet.experiences.map((experience) => <Text key={experience.id} style={styles.diaryEntry}>• {experience.summary.replace(state.pet.ownerId, "你")}</Text>)}
            {state.evolutionEvents.map((event, index) => <Text key={`${event.visualTrait}-${index}`} style={styles.diaryEntry}>{writeGrowthDiary(event)}</Text>)}
          </View>
          <EvolutionSheet
            petName={state.pet.name}
            anchors={state.pet.identityAnchors}
            pending={state.pendingEvolution}
            canPropose={canProposeEvolution}
            onPropose={(ownerExpectation) => dispatch({ type: "PROPOSE_EVOLUTION", ownerExpectation })}
            onApply={() => dispatch({ type: "APPLY_EVOLUTION" })}
          />
        </View>

        <View style={styles.column}>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>可追溯记忆</Text>
            <Text style={styles.sectionNote}>全局记忆只在独处时使用；空间记忆互相隔离。你可以修改或删除自动记忆。</Text>
            <View style={styles.memoryList}>
              {visibleMemories.map((memory) => (
                <MemoryCard
                  key={memory.id}
                  memory={memory}
                  spaceName={spacesById.get(memory.spaceId) ?? "私人空间"}
                  onEdit={(content) => dispatch({ type: "EDIT_MEMORY", memoryId: memory.id, content })}
                  onDelete={() => dispatch({ type: "DELETE_MEMORY", memoryId: memory.id })}
                />
              ))}
            </View>
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
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginHorizontal: spacing.md },
  identityCard: { flexGrow: 2, flexShrink: 1, flexBasis: 520, minWidth: 280 },
  controlCard: { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 280 },
  column: { flexGrow: 1, flexShrink: 1, flexBasis: 400, minWidth: 280, gap: spacing.md },
  avatarRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md },
  identityCopy: { flex: 1, minWidth: 150 },
  petName: { color: colors.coralSoft, fontSize: 34, fontWeight: "900" },
  currentForm: { marginTop: spacing.xs, color: colors.lavenderSoft, fontSize: typography.bodyLarge, fontWeight: "800" },
  seed: { marginTop: spacing.xs, color: colors.textMuted, fontSize: typography.eyebrow },
  sectionTitle: { marginTop: spacing.sm, color: colors.text, fontSize: typography.title, fontWeight: "900" },
  sectionNote: { marginTop: spacing.xs, color: colors.textMuted, lineHeight: 20 },
  anchorWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  anchor: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, color: colors.textDark, backgroundColor: colors.lavenderSoft, borderRadius: radii.pill, fontWeight: "800" },
  traits: { marginTop: spacing.md, color: colors.mint, lineHeight: 21, fontWeight: "700" },
  controlButton: { marginTop: spacing.sm, padding: spacing.md, backgroundColor: colors.canvasRaised, borderColor: colors.line, borderWidth: 1, borderRadius: radii.sm },
  controlText: { color: colors.text, fontWeight: "900" },
  sectionCard: { padding: spacing.lg, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radii.lg },
  empty: { marginTop: spacing.md, color: colors.textMuted },
  diaryEntry: { marginTop: spacing.sm, color: colors.text, lineHeight: 22 },
  memoryList: { marginTop: spacing.md, gap: spacing.sm },
  memoryCard: { padding: spacing.md, backgroundColor: colors.canvasRaised, borderColor: colors.line, borderWidth: 1, borderRadius: radii.md },
  memoryScope: { color: colors.lavenderSoft, fontWeight: "900" },
  memoryContent: { marginTop: spacing.xs, color: colors.text, fontSize: typography.body, lineHeight: 22 },
  memoryMeta: { marginTop: spacing.xs, color: colors.textMuted, fontSize: 11, lineHeight: 17 },
  memoryActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  editText: { color: colors.mint, fontWeight: "800" },
  deleteText: { color: colors.coralSoft, fontWeight: "800" },
  memoryInput: { marginTop: spacing.sm, minHeight: 44, paddingHorizontal: spacing.sm, color: colors.text, borderColor: colors.lavender, borderWidth: 1, borderRadius: radii.sm },
  saveButton: { alignItems: "center", marginTop: spacing.sm, padding: spacing.sm, backgroundColor: colors.mint, borderRadius: radii.sm },
  saveText: { color: colors.textDark, fontWeight: "900" },
});
