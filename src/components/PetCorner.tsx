import { Pressable, StyleSheet, Text, View } from "react-native";
import type { GrowthExperience, PetCornerStory } from "../domain/types";
import { colors, radii, spacing, typography } from "../theme/tokens";

type PetCornerProps = Readonly<{
  petName: string;
  ownerId: string;
  currentUserId: string;
  memberNames: Readonly<Record<string, string>>;
  spaceName: string;
  stories: readonly PetCornerStory[];
  experiences: readonly GrowthExperience[];
  onCare: () => void;
  onInteract: () => void;
}>;

function friendlySummary(
  experience: GrowthExperience,
  currentUserId: string,
  memberNames: Readonly<Record<string, string>>,
): string {
  const actorId = experience.provenance?.actorId;
  if (!actorId) return experience.summary;
  const actorLabel = actorId === currentUserId ? "你" : memberNames[actorId] ?? actorId;
  return experience.summary.replace(actorId, actorLabel);
}

export function PetCorner({ petName, currentUserId, memberNames, spaceName, stories, experiences, onCare, onInteract }: PetCornerProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>PET CORNER / 仅带回高光</Text>
      <Text style={styles.title}>宠物角故事</Text>
      {stories.length ? stories.slice(-2).map((story) => <Text key={story.id} style={styles.story}>• {story.content}</Text>) : <Text style={styles.empty}>{petName}今天在{spaceName}安静整理小玩具。</Text>}
      <Text style={styles.subtitle}>照顾与互动</Text>
      {experiences.length ? experiences.slice(-2).map((experience) => <Text key={experience.id} style={styles.story}>{friendlySummary(experience, currentUserId, memberNames)}</Text>) : <Text style={styles.empty}>还没有新的照顾记录。</Text>}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel={`帮${petName}梳理触角`} onPress={onCare} style={styles.primary}><Text style={styles.primaryText}>梳理触角</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`和${petName}击掌互动`} onPress={onInteract} style={styles.secondary}><Text style={styles.secondaryText}>击掌互动</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, backgroundColor: colors.mintDeep, borderColor: "rgba(125,226,196,0.25)", borderWidth: 1, borderRadius: radii.lg },
  eyebrow: { color: colors.mint, fontSize: 10, fontWeight: "800", letterSpacing: 1.1 },
  title: { marginTop: spacing.xs, color: colors.text, fontSize: typography.title, fontWeight: "900" },
  subtitle: { marginTop: spacing.md, color: colors.mint, fontSize: typography.bodyLarge, fontWeight: "900" },
  story: { marginTop: spacing.sm, color: colors.text, fontSize: typography.body, lineHeight: 22 },
  empty: { marginTop: spacing.sm, color: colors.textMuted, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  primary: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.mint, borderRadius: radii.sm },
  primaryText: { color: colors.textDark, fontWeight: "900" },
  secondary: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderColor: colors.mint, borderWidth: 1, borderRadius: radii.sm },
  secondaryText: { color: colors.mint, fontWeight: "800" },
});
