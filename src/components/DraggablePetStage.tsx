import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, AppState, PanResponder, Pressable, Text, View } from "react-native";
import { createThemedStyles } from "../theme/themedStyles";
import { DEFAULT_PORTRAIT_POSITION, loadPortraitPosition, portraitOffset, savePortraitPosition, type PortraitPosition } from "../pets/portraitPosition";

type Props = Readonly<{ ownerId?: string; petId?: string; compact?: boolean; constrained?: boolean; onAppearance?(): void; children(size: number): ReactNode }>;
export function DraggablePetStage(props: Props) {
  // Remount the gesture/storage scope synchronously on either identity change.
  return <PositionedPet key={`${props.ownerId}:${props.petId}`} {...props} />;
}
function PositionedPet({ ownerId, petId, compact = false, constrained = false, onAppearance, children }: Props) {
  const { styles } = useStyles();
  const [position, setPosition] = useState<PortraitPosition>(DEFAULT_PORTRAIT_POSITION);
  const positionRef = useRef(position); positionRef.current = position;
  const [ready, setReady] = useState(!ownerId || !petId), [saveFailed, setSaveFailed] = useState(false);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const translation = useRef(new Animated.ValueXY()).current;
  const lifetime = useRef({ active: true }), editVersion = useRef(0), dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const size = Math.min(compact ? 56 : 120, Math.max(0, layout.width - 24), Math.max(0, layout.height - 24));
  const geometry = portraitOffset(position, layout.width, layout.height, size);
  const current = useRef({ geometry, position, size, ready }); current.current = { geometry, position, size, ready };
  useEffect(() => {
    const scope = lifetime.current; scope.active = true;
    const version = editVersion.current;
    if (ownerId && petId) void loadPortraitPosition(ownerId, petId).then(saved => {
      if (scope.active && editVersion.current === version) { positionRef.current = saved; setPosition(saved); }
    }).catch(() => { /* Damaged/unavailable local storage keeps the centered default. */ }).finally(() => { if (scope.active) setReady(true); });
    return () => { scope.active = false; dragging.current = false; translation.stopAnimation(); };
  }, [ownerId, petId, translation]);
  const save = (next: PortraitPosition) => {
    if (!lifetime.current.active) return;
    editVersion.current++; positionRef.current = next; setPosition(next); setSaveFailed(false);
    if (ownerId && petId) void savePortraitPosition(ownerId, petId, next, () => lifetime.current.active).catch(() => { if (lifetime.current.active) setSaveFailed(true); });
  };
  const saveRef = useRef(save); saveRef.current = save;
  const resetDrag = () => {
    dragging.current = false;
    const g = current.current.geometry;
    translation.setValue({ x: g.x, y: g.y });
  };
  const resetDragRef = useRef(resetDrag); resetDragRef.current = resetDrag;
  useEffect(() => { resetDragRef.current(); }, [layout.width, layout.height, size, compact, constrained, position.collapsed, position.x, position.y, translation]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", state => { if (state !== "active") resetDragRef.current(); });
    return () => listener.remove();
  }, []);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => lifetime.current.active && current.current.ready && gesture.numberActiveTouches === 1 && Math.hypot(gesture.dx, gesture.dy) > 7,
    onPanResponderGrant: () => {
      if (!lifetime.current.active) return;
      dragging.current = true; const g = current.current.geometry; dragStart.current = { x: g.x, y: g.y };
    },
    onPanResponderMove: (_event, gesture) => {
      if (!dragging.current || !lifetime.current.active) return;
      const g = current.current.geometry;
      translation.setValue({ x: Math.max(g.insetX, Math.min(g.insetX + g.rangeX, dragStart.current.x + gesture.dx)), y: Math.max(g.insetY, Math.min(g.insetY + g.rangeY, dragStart.current.y + gesture.dy)) });
    },
    onPanResponderRelease: (_event, gesture) => {
      if (!dragging.current || !lifetime.current.active) return;
      dragging.current = false; const { geometry: g, position: p } = current.current;
      saveRef.current({ ...p, x: g.rangeX ? Math.max(0, Math.min(1, (dragStart.current.x + gesture.dx - g.insetX) / g.rangeX)) : p.x, y: g.rangeY ? Math.max(0, Math.min(1, (dragStart.current.y + gesture.dy - g.insetY) / g.rangeY)) : p.y });
    },
    onPanResponderTerminationRequest: () => true,
    onPanResponderTerminate: () => resetDragRef.current(),
    onShouldBlockNativeResponder: () => false,
  }), [translation]);
  const moveAccessibly = (action: string) => {
    if (!ready) return;
    const p = positionRef.current;
    if (action === "reset") save(DEFAULT_PORTRAIT_POSITION);
    else save({ ...p, x: Math.max(0, Math.min(1, p.x + (action === "left" ? -.2 : action === "right" ? .2 : 0))), y: Math.max(0, Math.min(1, p.y + (action === "up" ? -.2 : action === "down" ? .2 : 0))) });
  };
  return <View testID="pet-position-stage" style={styles.stage}>
    <View style={styles.tools}>
      <Text style={styles.hint}>{position.collapsed ? "异宠已收起" : constrained ? "收起键盘后可移动异宠" : "拖动异宠，放在喜欢的位置"}</Text>
      {onAppearance ? <Pressable accessibilityRole="button" accessibilityLabel="形象与透明效果" style={styles.tool} onPress={onAppearance}><Text style={styles.action}>透明效果</Text></Pressable> : null}
      {!position.collapsed ? <Pressable accessibilityRole="button" accessibilityLabel="异宠位置复原" disabled={!ready} style={styles.tool} onPress={() => save(DEFAULT_PORTRAIT_POSITION)}><Text style={styles.action}>位置复原</Text></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={position.collapsed ? "显示异宠本体" : "收起异宠本体"} disabled={!ready} style={styles.tool} onPress={() => { resetDrag(); save({ ...positionRef.current, collapsed: !positionRef.current.collapsed }); }}><Text style={styles.action}>{position.collapsed ? "显示异宠" : "收起"}</Text></Pressable>
    </View>
    {!position.collapsed && !constrained ? <View testID="pet-position-canvas" pointerEvents="box-none" style={{ height: compact ? 80 : 200 }} onLayout={event => { const { width, height } = event.nativeEvent.layout; setLayout({ width, height }); }}>
      {size > 0 ? <Animated.View testID="pet-position-handle" accessibilityRole="adjustable" accessibilityLabel="可拖动的异宠本体" accessibilityHint="拖动可移动位置；也可使用向左、向右、向上、向下或位置复原操作" accessibilityActions={[{ name: "left", label: "向左移动" }, { name: "right", label: "向右移动" }, { name: "up", label: "向上移动" }, { name: "down", label: "向下移动" }, { name: "reset", label: "位置复原" }]} onAccessibilityAction={event => moveAccessibly(event.nativeEvent.actionName)} {...responder.panHandlers} style={[styles.pet, { width: size, height: size, transform: translation.getTranslateTransform() }]}>
        <View pointerEvents="none">{children(size)}</View>
      </Animated.View> : null}
    </View> : null}
    {saveFailed ? <Text accessibilityRole="alert" style={styles.hint}>位置暂未保存在本机，下次打开可能恢复居中。</Text> : null}
  </View>;
}
const useStyles = createThemedStyles((_colors, theme) => ({
  stage: { flexShrink: 0, backgroundColor: "transparent" },
  tools: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8 },
  hint: { flex: 1, color: theme.muted, fontSize: 11, lineHeight: 16 },
  tool: { minHeight: 40, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  action: { color: theme.primary, fontSize: 12 },
  pet: { position: "absolute", left: 0, top: 0, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
}));
