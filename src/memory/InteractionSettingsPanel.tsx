import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { InteractionSettings } from "../../supabase/functions/_shared/companionMemoryTypes";
import { createRequestId } from "../lib/uuid";
import { useAppTheme } from "../theme/ThemeProvider";
import { AppButton, AppField, Surface } from "../ui/common";
import { getMemoryContext, memoryError, mutateMemory, type MemoryContext } from "./repository";

type Key = keyof InteractionSettings;
const keys: [Key, string][] = [["address", "称呼"], ["response_length", "回应长度"], ["advice_frequency", "建议频率"], ["humor", "幽默"], ["teasing", "轻微吐槽"]];
const choices: Record<Key, [string, string][]> = {
  address: [], response_length: [["concise", "简短"], ["balanced", "均衡"], ["detailed", "详细"]],
  advice_frequency: [["listen", "先倾听"], ["when_asked", "问到才建议"], ["balanced", "适当建议"], ["proactive", "可以主动建议"]],
  humor: [["none", "严肃一些"], ["light", "轻松幽默"], ["playful", "活泼一些"]], teasing: [["none", "不要吐槽"], ["light", "偶尔轻微吐槽"]],
};
function InteractionSettingsContent({ petId }: { petId: string }) {
  const { theme } = useAppTheme();
  const [context, setContext] = useState<MemoryContext | null>(null);
  const [key, setKey] = useState<Key>("response_length");
  const [value, setValue] = useState("concise");
  const [scope, setScope] = useState("topic");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const latestPet = useRef(petId); latestPet.current = petId;
  const request = useRef<{ signature: string; id: string } | null>(null);
  const load = useCallback(async () => { try { const data = await getMemoryContext(petId); if (latestPet.current === petId) setContext(data); } catch (reason) { setError(memoryError(reason)); } }, [petId]);
  useEffect(() => { setContext(null); void load(); }, [load]);
  const save = async (action: "set_style" | "clear_style") => {
    if (busy || !context) return;
    const command = { action, expected_revision: context.revision, input: { key, value, scope, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai" } };
    const signature = JSON.stringify(command);
    if (request.current?.signature !== signature) request.current = { signature, id: createRequestId() };
    setBusy(true); setError("");
    try { await mutateMemory({ ...command, request_id: request.current.id }); if (latestPet.current === petId) { await load(); setError(action === "clear_style" ? "已恢复这一项的默认相处方式。" : "相处方式已保存，可以继续当前话题。"); } }
    catch (reason) { setError(memoryError(reason)); } finally { setBusy(false); }
  };
  return <Surface style={{ gap: 12 }}>
    <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>怎样和你相处</Text>
    <Text style={{ color: theme.muted }}>性格底色保持稳定，你明确不喜欢的方式优先停止。</Text>
    <View style={{ gap: 8 }}>{keys.map(([item, label]) => <AppButton key={item} label={label} variant={key === item ? "primary" : "secondary"} onPress={() => { setKey(item); setValue(context?.settings[item] ?? choices[item][0]?.[0] ?? ""); }} />)}</View>
    {key === "address" ? <AppField label="希望怎样称呼你" value={value} maxLength={40} onChangeText={setValue} /> : <View style={{ gap: 8 }}>{choices[key].map(([item, label]) => <AppButton key={item} label={label} variant={value === item ? "primary" : "secondary"} onPress={() => setValue(item)} />)}</View>}
    <Text style={{ color: theme.text }}>有效范围</Text>
    {[["topic", "这次话题"], ["today", "今天（到当地午夜）"], ["permanent", "以后都这样"]].map(([item, label]) => <AppButton key={item} label={label} variant={scope === item ? "primary" : "secondary"} onPress={() => setScope(item)} />)}
    <Text style={{ color: theme.muted }}>未明确长期要求时，默认只影响当前话题。设置时使用当前时区，设备切换不会改变保存的结束时间。</Text>
    {error ? <Text accessibilityRole="alert" style={{ color: theme.text }}>{error}</Text> : null}
    <AppButton label="保存相处方式" disabled={busy || !context || !value.trim()} onPress={() => void save("set_style")} />
    <AppButton label="恢复这一项默认设置" variant="quiet" disabled={busy || !context} onPress={() => void save("clear_style")} />
    <AppButton label="刷新当前设置" variant="quiet" disabled={busy} onPress={() => void load()} />
  </Surface>;
}
export function InteractionSettingsPanel(props: { petId: string }) { return <InteractionSettingsContent key={props.petId} {...props} />; }
