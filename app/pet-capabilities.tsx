import { useSession } from "../src/auth/SessionProvider";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Text, View } from "react-native";
import { PetFeatureScreen } from "../src/navigation/PetFeatureScreen";
import { useOwnedPet, OwnedPetGate } from "../src/navigation/useOwnedPet";
import { useAppTheme } from "../src/theme/ThemeProvider";
import { AppButton, AppField, Surface } from "../src/ui/common";
import { KeyboardScreen, KeyboardScrollView } from "../src/components/KeyboardLayout";
import { requireSupabase } from "../src/lib/supabase";
import { PET_CAPABILITIES, type PetCapability, type PetDelegationGrant, type PetActionReceipt } from "../supabase/functions/_shared/petCapabilities";

type Catalog = { capabilities:(PetCapability & {availability?:{available:boolean;reason:string}})[]; resources: { id:string; label:string; domain:string; space_id:string|null }[]; enabled: boolean; pet_id: string; grants: PetDelegationGrant[]; receipts: PetActionReceipt[]; spaces: { space_id: string; spaces: { name: string } }[]; members: { space_id: string; user_id: string; profiles: { nickname: string } }[] };
const modes = { public: "当前群公共能力", owner_read: "主人可查询", grant: "按范围预授权", confirm: "本人最终确认", device: "在当前设备操作", unavailable: "暂未开放" };
export default function PetCapabilitiesRoute() { const { profile } = useSession(); return <PetCapabilitiesContent key={profile?.id ?? "guest"} />; }
function PetCapabilitiesContent() {
  const state = useOwnedPet(); const { theme } = useAppTheme();
  const [data, setData] = useState<Catalog | null>(null), [error, setError] = useState("");
  const [selected, setSelected] = useState<PetCapability | null>(null), [space, setSpace] = useState<string | null>(null), [initiator, setInitiator] = useState<string | null>(null), [resource, setResource] = useState("");
  const [busy, setBusy] = useState(false), [query, setQuery] = useState("");
  const owner = state.profile?.id;
  const load = useCallback(async () => {
    if (!owner || state.isLocalDemo) return;
    const response = await requireSupabase().functions.invoke("pet-capabilities", { body: {} });
    if (response.error || response.data?.error) throw new Error("能力与授权暂未加载，请稍后重试。");
    setData(response.data);
  }, [owner, state.isLocalDemo]);
  useEffect(() => { setData(null); void load().catch(reason => setError(reason.message)); }, [load]);
  const mutate = async (command: Record<string, unknown>) => {
    if (!data || busy) return; setBusy(true); setError("");
    try { const result = await requireSupabase().rpc("manage_pet_delegation", { command: { ...command, pet_id: data.pet_id } }); if (result.error) throw result.error; setSelected(null); await load(); }
    catch (reason) { setError(/conflict/.test(String((reason as Error).message)) ? "授权已有变化，请刷新后重试。" : "这项授权未保存，请检查群成员、资料范围和当前权限。"); }
    finally { setBusy(false); }
  };
  return <PetFeatureScreen title="能力与授权" description="异宠只能在你选择的动作和范围内办事。授权持续到你撤销，不会自动覆盖新群或新增能力。"><OwnedPetGate state={state}>
    {error ? <><Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text><AppButton label="重新加载" variant="quiet" onPress={() => void load().catch(reason => setError(reason.message))} /></> : null}
    {!data && !state.isLocalDemo && !error ? <ActivityIndicator /> : null}
    {data && !data.enabled ? <Text style={{ color: theme.muted }}>能力执行正在完成发布验证，当前授权不会提前触发操作。</Text> : null}
    {state.isLocalDemo ? <Text style={{ color: theme.muted }}>演示模式可查看能力目录，授权需要真实登录。</Text> : null}
    <AppField label="查找能力" value={query} onChangeText={setQuery} placeholder="例如：提醒、事项、主人" />
    {(data?.capabilities ?? PET_CAPABILITIES).filter(cap => `${cap.label}${cap.category}`.includes(query.trim())).map(cap => {
      const availability = "availability" in cap ? cap.availability as {available:boolean;reason:string} : null;
      const grants = data?.grants.filter(g => g.capability === cap.id && (!g.expires_at || Date.parse(g.expires_at) > Date.now())) ?? [];
      return <Surface key={cap.id} style={{ gap: 8 }}><Text style={{ color: theme.text, fontWeight: "600" }}>{cap.label}</Text><Text style={{ color: theme.muted }}>{cap.category} · {modes[cap.mode]}{cap.mode === "grant" && !grants.length ? " · 尚未授权" : ""}</Text>
        <Text style={{color:theme.muted}}>{cap.scenes?.includes("space") ? "可在私人陪伴和允许参与的群内请求" : "在私人陪伴中提出请求"} · {cap.initiators === "owner_only" ? "仅主人本人发起" : cap.mode === "public" ? "当前群成员可发起" : "指定成员需单独授权"}</Text>
        {availability?.available === false ? <Text style={{color:theme.muted}}>{availability.reason}</Text> : null}
        {grants.map(g => <View key={g.id} style={{ gap: 6 }}><Text style={{ color: theme.text }}>{g.initiator_id === owner ? "本人发起" : data?.members.find(m => m.user_id === g.initiator_id)?.profiles?.nickname ?? "指定成员"} · {g.target_scope === "personal" ? "个人范围" : data?.spaces.find(s => `space:${s.space_id}` === g.target_scope)?.spaces?.name ?? "指定资料"} · {g.expires_at ? new Date(g.expires_at).toLocaleDateString() : "持续到撤销"}</Text><AppButton label="撤销此授权" variant="quiet" disabled={busy} onPress={() => void mutate({ action: "revoke", grant_id: g.id, expected_version: g.version })} /></View>)}
        {["grant", "owner_read", "public"].includes(cap.mode) ? <AppButton label="授权具体范围" variant="quiet" disabled={!data || busy || availability?.available === false} onPress={() => { setSelected(cap); setSpace(null); setInitiator(owner ?? null); setResource(""); }} /> : null}
      </Surface>;
    })}
    <Text style={{ color: theme.text, fontSize: 18 }}>最近执行记录</Text>
    {data?.receipts.length ? data.receipts.map(row => <View key={row.id} style={{ gap: 4 }}><Text style={{ color: theme.text }}>{row.summary}</Text><Text style={{ color: theme.muted }}>{row.created_at ? new Date(row.created_at).toLocaleString() : ""} · {row.status === "succeeded" ? "执行成功" : row.status === "not_granted" ? "未授权" : row.status === "needs_confirmation" ? "待本人操作" : row.status === "needs_clarification" ? "待补充" : "未完成"}</Text></View>) : <Text style={{ color: theme.muted }}>还没有执行记录。</Text>}
    <Modal visible={!!selected} animationType="slide" onRequestClose={() => { if (!busy) setSelected(null); }}><KeyboardScreen style={{ flex: 1, backgroundColor: theme.page }}><KeyboardScrollView contentContainerStyle={{ padding: 24, paddingTop: 48, gap: 12 }}>
      <Text style={{ color: theme.text, fontSize: 20 }}>授权：{selected?.label}</Text><Text style={{ color: theme.muted }}>下面范围内的明确请求会直接执行。本人确认和系统权限不会因此跳过。</Text>
      <Text style={{ color: theme.text }}>目标范围</Text><AppButton label="个人范围" variant={!space ? "primary" : "quiet"} onPress={() => { setSpace(null); setResource(""); setInitiator(owner ?? null); }} />
      {data?.spaces.map(s => <AppButton key={s.space_id} label={s.spaces?.name ?? "关系空间"} variant={space === s.space_id ? "primary" : "quiet"} onPress={() => { setSpace(s.space_id); setResource(""); setInitiator(owner ?? null); }} />)}
      <Text style={{ color: theme.text }}>允许谁发起</Text><AppButton label="仅本人" variant={initiator === owner ? "primary" : "quiet"} onPress={() => setInitiator(owner ?? null)} />
      {data?.members.filter(m => selected?.initiators !== "owner_only" && m.space_id === space && m.user_id !== owner).map(m => <AppButton key={m.user_id} label={m.profiles?.nickname ?? "群成员"} variant={initiator === m.user_id ? "primary" : "quiet"} onPress={() => setInitiator(m.user_id)} />)}
      <Text style={{ color: theme.text }}>具体资料或事项</Text>
      <AppButton label="使用上面选择的范围" variant={!resource ? "primary" : "quiet"} onPress={() => setResource("")} />
      {data?.resources.filter(row => row.domain === selected?.id.split(".")[0] && (!row.space_id || row.space_id === space)).map(row => <AppButton key={row.id} label={row.label || "未命名资料"} variant={resource === row.id ? "primary" : "quiet"} onPress={() => setResource(row.id)} />)}
      {space && ["memory", "preference", "reminder", "personality", "background"].includes(selected?.id.split(".")[0] ?? "") ? <Text style={{ color: theme.muted }}>私人资料用于群内请求时，必须限定具体资料；授权同时允许向这个群展示相应结果。</Text> : null}
      {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
      <AppButton label="确认授权，范围内直接执行" disabled={busy || !selected || !!resource && !/^[0-9a-f-]{36}$/i.test(resource)} onPress={() => void mutate({ action: "grant", capability: selected!.id, initiator_id: initiator, target_scope: resource.trim() ? `resource:${resource.trim()}` : space ? `space:${space}` : "personal", audience_space_id: space, expires_at: null })} />
      <AppButton label="取消" variant="quiet" disabled={busy} onPress={() => setSelected(null)} />
    </KeyboardScrollView></KeyboardScreen></Modal>
  </OwnedPetGate></PetFeatureScreen>;
}
