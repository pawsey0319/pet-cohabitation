import { usePetWorkspace } from "../pets/PetWorkspaceProvider";
import { usePetSectionFocusEffect as useFocusEffect } from "../pets/PetSectionScope";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Image, Pressable, Text, View } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";
import { createRequestId } from "../lib/uuid";
import { useAppTheme } from "../theme/ThemeProvider";
type DisplayState = {
  preference: { version: number; use_transparent: boolean; approved_job_id?: string | null; approved_source_asset_id?: string | null; approved_display_version?: number | null; approved_at?: string | null };
  source_asset_id: string;
  url: string | null;
  candidate_url?: string | null;
  job: { id: string; status: string; error_code: string | null } | null;
};
const PENDING_REFRESH_MS = 5000;
// Storage URLs expire after 300 seconds. Refresh visible results with a minute
// of headroom; terminal states without a usable image need no timer.
const IMAGE_REFRESH_MS = 240000;
async function request<T>(ownerId: string, body: Record<string, unknown>): Promise<T> {
  const client = requireSupabase(); const session = await client.auth.getSession();
  if (session.data.session?.user.id !== ownerId) throw new Error("账号已切换，请重新打开。");
  const result = await client.functions.invoke("pet-display", { body, headers: { Authorization: `Bearer ${session.data.session.access_token}` } });
  if (result.error || result.data?.error) throw new Error("本次操作未完成。请稍后重试。");
  return result.data as T;
}
export function usePetDisplay(petId: string | null | undefined, sourceAssetId: string | null | undefined) {
  const { profile, isLocalDemo } = useSession(); const key = `${profile?.id}:${petId}:${sourceAssetId}`;
  const workspace = usePetWorkspace();
  const cacheKey = `pet-display:${key}`;
  type Snapshot = { key: string; data: DisplayState; expiresAt: number };
  const [stored, setStored] = useState<Snapshot | null>(() => workspace?.cache.peek<Snapshot>(cacheKey) ?? null); const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const requests = useRef(new Map<string, string>()); const currentKey = useRef(key); currentKey.current = key;
  const idFor = (operation: string) => { const id = requests.current.get(operation) ?? createRequestId(); requests.current.set(operation, id); return id; };
  const state = stored?.key === key && stored.expiresAt > Date.now() ? stored.data : null;
  useEffect(() => {
    if (!stored || !Number.isFinite(stored.expiresAt)) return;
    const timer = setTimeout(() => { setStored(null); workspace?.cache.invalidate([cacheKey], true); }, Math.max(0, stored.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [stored, workspace, cacheKey]);
  const ready = state?.preference.use_transparent && state.job?.status === "succeeded" && state.source_asset_id === sourceAssetId;
  // Treat older-server URLs as previews too; missing approval metadata never
  // silently selects a completed derivative as the main pet portrait.
  const candidateUrl = ready ? state.candidate_url ?? state.url : null;
  const approved = ready && state.preference.approved_job_id === state.job?.id && state.preference.approved_source_asset_id === sourceAssetId && state.preference.approved_display_version === state.preference.version && !!state.preference.approved_at;
  useEffect(() => { setBusy(false); setError(null); requests.current.clear(); }, [key]);
  useFocusEffect(useCallback(() => {
    if (!profile || !petId || !sourceAssetId || isLocalDemo) return; let active = true; let timer: ReturnType<typeof setTimeout>; let sequence = 0;
    let foreground = AppState.currentState == null || AppState.currentState === "active";
    const current = () => active && foreground && currentKey.current === key;
    const poll = async () => {
      clearTimeout(timer); if (!current()) return; const generation = ++sequence; let refreshAfter: number | null = null;
      try {
        const fetch = async (): Promise<Snapshot> => { const started = Date.now(); const data = await request<DisplayState>(profile.id, { action: "status", pet_id: petId }); return { key, data, expiresAt: data.preference.use_transparent && data.job?.status === "succeeded" && (data.url || data.candidate_url) ? started + 290_000 : Infinity }; };
        const snapshot = workspace ? await workspace.cache.read(cacheKey, fetch, 0, false) : await fetch();
        const data = snapshot.data;
        if (current() && generation === sequence) {
          const matchesSource = data.source_asset_id === sourceAssetId;
          setStored(matchesSource ? snapshot : null);
          if (matchesSource && data.preference.use_transparent) {
            if (["queued", "running", "uploading"].includes(data.job?.status ?? "")) refreshAfter = PENDING_REFRESH_MS;
            else if (data.job?.status === "succeeded" && (data.candidate_url || data.url)) refreshAfter = IMAGE_REFRESH_MS;
          }
        }
      } catch { if (current() && generation === sequence) { setStored(value => value && value.expiresAt > Date.now() ? value : null); refreshAfter = PENDING_REFRESH_MS; } }
      if (refreshAfter !== null && current() && generation === sequence) timer = setTimeout(() => void poll(), refreshAfter);
    };
    const client = requireSupabase();
    const channel = client.channel(`pet-display:${profile.id}:${petId}:${sourceAssetId}:${createRequestId()}`, { config: { broadcast: { replication_ready: true } } })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pet_display_preferences", filter: `pet_id=eq.${petId}` }, event => {
        if (active && currentKey.current === key && event.new.owner_id === profile.id && event.new.pet_id === petId) { sequence++; workspace?.cache.invalidate([cacheKey], true); setStored(null); void poll(); }
      })
      .on("system", {}, event => { if (event.status === "ok" && event.extension === "postgres_changes") void poll(); })
      .subscribe(status => {
        if (status === "SUBSCRIBED") void poll();
        if (active && currentKey.current === key && ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) { sequence++; clearTimeout(timer); timer = setTimeout(() => void poll(), PENDING_REFRESH_MS); }
      });
    const listener = AppState.addEventListener("change", next => {
      if (!active || currentKey.current !== key) return;
      foreground = next === "active";
      if (foreground) void poll(); else { sequence++; clearTimeout(timer); }
    });
    void poll(); return () => { active = false; sequence++; clearTimeout(timer); listener.remove(); void client.removeChannel(channel); };
  }, [key, profile?.id, petId, sourceAssetId, isLocalDemo, revision, workspace]));
  const change = async (transparent: boolean) => {
    if (!profile || !petId || !state) return; setBusy(true); setError(null);
    if (!transparent) setStored(null);
    try {
      let version = state.preference.version;
      if (state.preference.use_transparent !== transparent) {
        const updated = await request<{ preference: { version: number } }>(profile.id, { action: "set", pet_id: petId, request_id: idFor(`${key}:set:${version}:${transparent}`), expected_version: version, use_transparent: transparent });
        version = updated.preference.version;
      }
      // Repeated enable must not increment a reviewed version or regenerate a
      // ready candidate. Explicit restore and re-enable uses a new version.
      if (transparent && (version !== state.preference.version || !["queued", "running", "uploading", "succeeded"].includes(state.job?.status ?? ""))) await request(profile.id, { action: "request", pet_id: petId, request_id: idFor(`${key}:request:${version}:${state.job?.status === "failed" ? state.job.id : "initial"}`), expected_version: version });
      if (currentKey.current === key) { workspace?.cache.invalidate([cacheKey], true); setRevision(value => value + 1); }
    } catch (reason) { if (currentKey.current === key) setError(reason instanceof Error ? reason.message : "暂时未完成"); }
    finally { if (currentKey.current === key) setBusy(false); }
  };
  const approve = async () => {
    if (!profile || !petId || !state || !ready || !candidateUrl || !state.job || approved) return;
    setBusy(true); setError(null);
    try {
      await request(profile.id, { action: "approve", pet_id: petId, job_id: state.job.id, source_asset_id: state.source_asset_id, expected_version: state.preference.version, request_id: idFor(`${key}:approve:${state.job.id}:${state.preference.version}`) });
      // Fetch current authoritative state rather than applying a possibly
      // delayed approval receipt after source/version/owner changes.
      if (currentKey.current === key) { workspace?.cache.invalidate([cacheKey], true); setRevision(value => value + 1); }
    } catch (reason) { if (currentKey.current === key) setError(reason instanceof Error ? reason.message : "暂时未完成"); }
    finally { if (currentKey.current === key) setBusy(false); }
  };
  return { url: approved ? state.url : null, candidateUrl, state, error, busy, change, approve };
}
export function PetDisplayControls({ display }: { display: ReturnType<typeof usePetDisplay> }) {
  const { theme } = useAppTheme(); if (!display.state) return null;
  const pending = ["queued", "running", "uploading"].includes(display.state.job?.status ?? "");
  return <View style={{ gap: 8 }}>
    {pending ? <Text style={{ color: theme.muted, fontSize: 13 }}>正在整理形象，完成后先预览，确认后才会替换本体。原图已保留。</Text> : null}
    {display.error || display.state.job?.status === "failed" ? <Text style={{ color: theme.muted, fontSize: 13 }}>{display.error ?? "本次形象整理未完成，原图已保留。"}</Text> : null}
    {display.candidateUrl && !display.url ? <View style={{ gap: 8 }}>
      <Text style={{ color: theme.text, fontWeight: "600" }}>透明效果预览</Text>
      <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>请检查身体、四肢、毛发和饰品是否完整。效果不合适时保留原图。</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>{["#ffffff", "#17202d"].map((backgroundColor, index) => <View key={backgroundColor} style={{ flex: 1, aspectRatio: 1, borderRadius: 12, overflow: "hidden", backgroundColor }}><Image accessibilityLabel={index ? "透明候选图深色背景预览" : "透明候选图浅色背景预览"} source={{ uri: display.candidateUrl! }} resizeMode="contain" style={{ width: "100%", height: "100%" }} /></View>)}</View>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: display.busy }} disabled={display.busy} onPress={() => void display.approve()} style={{ minHeight: 44, justifyContent: "center", alignItems: "center" }}><Text style={{ color: theme.primary }}>使用此透明效果</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: display.busy }} disabled={display.busy} onPress={() => void display.change(false)} style={{ minHeight: 44, justifyContent: "center", alignItems: "center" }}><Text style={{ color: theme.primary }}>保留原图</Text></Pressable>
    </View> : null}
    {!display.url && !display.candidateUrl && !pending ? <Pressable accessibilityRole="button" disabled={display.busy} onPress={() => void display.change(true)} style={{ minHeight: 44, justifyContent: "center", alignItems: "center" }}><Text style={{ color: theme.primary }}>预览透明效果</Text></Pressable> : null}
    {display.state.preference.use_transparent && (display.url || pending) ? <Pressable accessibilityRole="button" disabled={display.busy} onPress={() => void display.change(false)} style={{ minHeight: 44, justifyContent: "center", alignItems: "center" }}><Text style={{ color: theme.primary }}>恢复原图</Text></Pressable> : null}
  </View>;
}
