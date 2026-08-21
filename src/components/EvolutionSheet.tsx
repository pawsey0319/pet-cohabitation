import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { EvolutionEvent, IdentityAnchors } from "../domain/types";
import { colors, radii, spacing, typography } from "../theme/tokens";

type EvolutionSheetProps = Readonly<{
  petName: string;
  anchors: IdentityAnchors;
  pending: EvolutionEvent | null;
  canPropose: boolean;
  onPropose: (expectation: string) => void;
  onApply: () => void;
}>;

export function EvolutionSheet({ petName, anchors, pending, canPropose, onPropose, onApply }: EvolutionSheetProps) {
  const [expectation, setExpectation] = useState("");
  const inherited = [anchors.eyes, anchors.coreColor, anchors.voice, anchors.silhouette, anchors.signatureOrgan].join("、");

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>SHALLOW PARTICIPATION</Text>
      <Text style={styles.title}>下一次生长，留一句祝福</Text>
      <Text style={styles.copy}>你可以写期待、祝福或象征物；变化由{petName}依据生命故事自主决定。</Text>
      {pending ? (
        <View style={styles.decision}>
          <Text style={styles.decisionTitle}>决定者：{petName}</Text>
          <Text style={styles.decisionText}>期待 / 祝福：{pending.ownerInfluence}</Text>
          <Text style={styles.decisionText}>
            {pending.visualTrait ? `自主变化：${pending.visualTrait}` : "自主变化：暂时保持现在的样子"}
          </Text>
          <Text style={styles.decisionText}>
            原因：{pending.sources.length ? `来自${pending.sources.map((source) => source.summary).join("；")}` : "还没有足够的生命故事，先把祝福收好"}
          </Text>
          <Text style={styles.inherited}>继承特征：{inherited}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`接受${petName}的成长`} onPress={onApply} style={styles.accept}>
            <Text style={styles.acceptText}>接受{petName}的成长</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <TextInput
            accessibilityLabel="期待或祝福"
            placeholder="写下你的期待或祝福"
            placeholderTextColor={colors.textMuted}
            value={expectation}
            onChangeText={setExpectation}
            style={styles.input}
          />
          {!canPropose ? <Text style={styles.waiting}>等待新的共同故事后再生长</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`交给${petName}决定`} disabled={!canPropose || !expectation.trim()} onPress={() => onPropose(expectation)} style={[styles.primary, (!canPropose || !expectation.trim()) && styles.disabled]}>
            <Text style={styles.primaryText}>交给{petName}决定</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radii.lg },
  eyebrow: { color: colors.coral, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  title: { marginTop: spacing.xs, color: colors.text, fontSize: typography.title, fontWeight: "900" },
  copy: { marginTop: spacing.sm, color: colors.textMuted, lineHeight: 21 },
  input: { marginTop: spacing.md, minHeight: 48, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.canvasRaised, borderColor: colors.line, borderWidth: 1, borderRadius: radii.sm },
  primary: { alignItems: "center", marginTop: spacing.sm, padding: spacing.sm, backgroundColor: colors.coral, borderRadius: radii.sm },
  primaryText: { color: colors.textDark, fontWeight: "900" },
  disabled: { opacity: 0.45 },
  waiting: { marginTop: spacing.sm, color: colors.textMuted, fontSize: typography.eyebrow },
  decision: { marginTop: spacing.md, padding: spacing.md, backgroundColor: "rgba(190,184,248,0.1)", borderRadius: radii.md, gap: spacing.xs },
  decisionTitle: { color: colors.lavenderSoft, fontSize: typography.bodyLarge, fontWeight: "900" },
  decisionText: { color: colors.text, lineHeight: 21 },
  inherited: { color: colors.mint, lineHeight: 21, fontWeight: "700" },
  accept: { alignItems: "center", marginTop: spacing.sm, padding: spacing.sm, backgroundColor: colors.lavenderSoft, borderRadius: radii.sm },
  acceptText: { color: colors.textDark, fontWeight: "900" },
});
