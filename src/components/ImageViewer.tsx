import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { imageViewerReducer, initialImageViewerTransform } from "../chat/imageViewerState";
import { colors } from "../theme/tokens";

type Props = Readonly<{
  visible: boolean;
  url: string | null;
  loading?: boolean;
  onClose(): void;
  onRetry(): void;
}>;

function touchDistance(touches: readonly { pageX: number; pageY: number }[]): number | null {
  if (touches.length < 2) return null;
  return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
}

export function ImageViewer({ visible, url, loading = false, onClose, onRetry }: Props) {
  const [transform, dispatch] = useReducer(imageViewerReducer, initialImageViewerTransform);
  const [failed, setFailed] = useState(false);
  const lastTap = useRef(0);
  const retriedUrl = useRef<string | null>(null);
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);
  const scaleRef = useRef(transform.scale);
  useEffect(() => { scaleRef.current = transform.scale; }, [transform.scale]);
  useEffect(() => { setFailed(false); }, [url]);
  useEffect(() => {
    if (!visible) { dispatch({ type: "reset" }); setFailed(false); }
    if (Platform.OS !== "web" || !visible || typeof window === "undefined") return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, visible]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      const touches = event.nativeEvent.touches as unknown as readonly { pageX: number; pageY: number }[];
      const distance = touchDistance(touches);
      pinchStart.current = distance ? { distance, scale: scaleRef.current } : null;
    },
    onPanResponderMove: (event, gesture) => {
      const touches = event.nativeEvent.touches as unknown as readonly { pageX: number; pageY: number }[];
      const distance = touchDistance(touches);
      if (distance && pinchStart.current) dispatch({ type: "zoom", scale: pinchStart.current.scale * distance / pinchStart.current.distance });
      else if (scaleRef.current > 1) dispatch({ type: "pan", dx: gesture.dx / 12, dy: gesture.dy / 12 });
    },
    onPanResponderRelease: () => { pinchStart.current = null; },
    onPanResponderTerminate: () => { pinchStart.current = null; },
  }), []);

  const onTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 320) dispatch({ type: "zoom", scale: transform.scale > 1 ? 1 : 2 });
    lastTap.current = now;
  };
  const wheelProps = Platform.OS === "web" ? ({
    onWheel: (event: { preventDefault(): void; deltaY: number }) => {
      event.preventDefault();
      dispatch({ type: "zoom", scale: transform.scale * (event.deltaY > 0 ? 0.9 : 1.1) });
    },
  } as object) : {};

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
    <View style={styles.root}>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.toolbar}><Text style={styles.zoomText}>{Math.round(transform.scale * 100)}%</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" onPress={onClose} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable></View>
      <View testID="image-viewer-stage" {...wheelProps} {...responder.panHandlers} style={styles.stage}>
        {loading ? <ActivityIndicator color={colors.mint} size="large" /> : failed || !url ? <View style={styles.failed}><Text style={styles.failedText}>图片暂时无法加载</Text><Pressable onPress={() => { setFailed(false); retriedUrl.current = null; onRetry(); }} style={styles.retry}><Text style={styles.retryText}>刷新后重试</Text></Pressable></View> : <Pressable onPress={onTap}><Image onError={() => { if (retriedUrl.current !== url) { retriedUrl.current = url; onRetry(); } else setFailed(true); }} source={{ uri: url }} resizeMode="contain" style={[styles.image, { transform: [{ translateX: transform.translateX }, { translateY: transform.translateY }, { scale: transform.scale }] }]} /></Pressable>}
      </View>
      <Text style={styles.hint}>双击 / 滚轮 / 双指缩放 · 放大后拖动</Text>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "rgba(3,3,10,.96)", alignItems: "center", justifyContent: "center" },
  toolbar: { position: "absolute", zIndex: 2, top: 22, left: 18, right: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  zoomText: { color: colors.textMuted, fontSize: 12 }, closeButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,.12)", alignItems: "center", justifyContent: "center" }, closeText: { color: colors.text, fontSize: 30, lineHeight: 32 },
  stage: { width: "100%", height: "82%", alignItems: "center", justifyContent: "center", overflow: "hidden" }, image: { width: Platform.OS === "web" ? ("82vw" as never) : 360, height: Platform.OS === "web" ? ("78vh" as never) : 560 },
  failed: { alignItems: "center", gap: 14 }, failedText: { color: colors.text }, retry: { backgroundColor: colors.mintDeep, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 18 }, retryText: { color: colors.mint, fontWeight: "900" },
  hint: { position: "absolute", bottom: 22, color: colors.textMuted, fontSize: 11 },
});
