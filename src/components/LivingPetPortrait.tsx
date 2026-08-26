import { type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from "react-native";
import type { PetMotionState } from "../data/types";
import { colors, radii } from "../theme/tokens";
import { ThemeContext } from "../theme/ThemeContext";

const LABELS: Readonly<Record<PetMotionState, string>> = {
  idle: "自在呼吸",
  listening: "正在倾听",
  thinking: "正在想",
  speaking: "正在回应",
  happy: "心情很好",
  eating: "认真进食",
  playing: "正在玩耍",
  sleeping: "安心休息",
};

const ICONS: Readonly<Partial<Record<PetMotionState, string>>> = {
  listening: "♪",
  thinking: "…",
  speaking: "✦",
  happy: "♡",
  eating: "◌",
  playing: "✧",
  sleeping: "Zzz",
};

export function LivingPetPortrait({ state, children, compact = false, reduceMotion: reduceMotionOverride = false }: Readonly<{ state: PetMotionState; children: ReactNode; compact?: boolean; reduceMotion?: boolean }>) {
  const themeContext = useContext(ThemeContext);
  const progress = useRef(new Animated.Value(0)).current;
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);
  const reduceMotion = reduceMotionOverride || themeContext?.preferences.reduceMotion === true || systemReduceMotion;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setSystemReduceMotion);
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", setSystemReduceMotion);
    return () => listener.remove();
  }, []);

  useEffect(() => {
    progress.stopAnimation();
    progress.setValue(0);
    if (reduceMotion) return;
    const duration = state === "sleeping" ? 2200 : state === "idle" ? 1800 : 650;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion, state]);

  const motion = useMemo(() => {
    const ranges: Readonly<Record<PetMotionState, { y: number; x: number; scale: number; rotate: number }>> = {
      idle: { y: -2, x: 0, scale: .018, rotate: 0 },
      listening: { y: -3, x: 3, scale: .025, rotate: 2 },
      thinking: { y: -4, x: 2, scale: .02, rotate: -2 },
      speaking: { y: -3, x: 0, scale: .035, rotate: 1 },
      happy: { y: -12, x: 0, scale: .04, rotate: 3 },
      eating: { y: 5, x: 0, scale: -.025, rotate: 0 },
      playing: { y: -8, x: 10, scale: .025, rotate: 7 },
      sleeping: { y: 3, x: 0, scale: -.035, rotate: -2 },
    };
    return ranges[state];
  }, [state]);

  const transform = reduceMotion ? undefined : [
    { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, motion.y] }) },
    { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, motion.x] }) },
    { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + motion.scale] }) },
    { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${motion.rotate}deg`] }) },
  ];

  return <View accessibilityLabel={`异宠状态：${LABELS[state]}`} style={styles.wrap}>
    <Animated.View style={{ transform }}>{children}</Animated.View>
    {ICONS[state] ? <Animated.Text style={[styles.effect, compact && styles.effectCompact, !reduceMotion && { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [.45, 1] }) }]}>{ICONS[state]}</Animated.Text> : null}
    {!compact ? <View style={styles.status}><View style={[styles.dot, state === "sleeping" && styles.dotSleeping]} /><Text style={styles.statusText}>{LABELS[state]}</Text></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", position: "relative" },
  effect: { position: "absolute", right: 8, top: 8, color: colors.coralSoft, fontSize: 24, fontWeight: "900" },
  effectCompact: { right: 2, top: 2, fontSize: 13 },
  status: { marginTop: 8, flexDirection: "row", gap: 7, alignItems: "center", backgroundColor: colors.surface, paddingHorizontal: 11, paddingVertical: 6, borderRadius: radii.pill },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.mint },
  dotSleeping: { backgroundColor: colors.lavender },
  statusText: { color: colors.textMuted, fontSize: 11, fontWeight: "800" },
});
