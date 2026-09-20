import { useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { AppButton, AppField, Surface } from "../ui/common";
import { useNotificationPreferences } from "./preferences";
import { isQuietTime, newReminderRequestId, submitReminder, validateReminder, type ReminderInput, type ReminderRule, type ReminderSeries } from "./reminders";

const frequencies: [ReminderRule["frequency"], string][] = [["once", "一次"], ["daily", "每天"], ["weekly", "每周"], ["weekdays", "工作日"], ["monthly", "每月"], ["interval", "自定义间隔"]];
export function ReminderEditor({ itemId, initial, initialTitle = "", onSaved }: { itemId?: string; initial?: ReminderSeries; initialTitle?: string; onSaved?(outcome: string): void }) {
  const { profile, isLocalDemo } = useSession();
  const { theme } = useAppTheme();
  const { preferences } = useNotificationPreferences();
  const [input, setInput] = useState<ReminderInput>(() => initial ?? { content: initialTitle, start_local: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai", rule: { frequency: "once" }, work_item_id: itemId });
  const [scope, setScope] = useState<"only" | "future" | "all">("all");
  const [selected, setSelected] = useState(initial?.next_at ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submitted = useRef<{ signature: string; requestId: string } | null>(null);
  const patch = (value: Partial<ReminderInput>) => setInput(current => ({ ...current, ...value }));
  const rule = (value: Partial<ReminderRule>) => setInput(current => ({ ...current, rule: { ...current.rule, ...value } }));
  const save = async (action: "create" | "edit" | "skip" | "cancel") => {
    if (!profile || busy) return;
    if (isLocalDemo) { setMessage("云端提醒需要登录真实账号后设置。"); return; }
    if (action === "create" || action === "edit") {
      const error = validateReminder(input); if (error) { setMessage(error); return; }
    }
    const draft = { action, ...(initial ? { series_id: initial.id, expected_version: initial.version, scope, ...(selected ? { scheduled_at: selected } : {}) } : {}), ...(["create", "edit"].includes(action) ? { input } : {}) };
    const signature = JSON.stringify(draft);
    if (submitted.current?.signature !== signature) submitted.current = { signature, requestId: newReminderRequestId() };
    setBusy(true); setMessage("");
    try {
      const result = await submitReminder(profile.id, { ...draft, request_id: submitted.current.requestId });
      setMessage(result.outcome === "pending_sync" ? "待同步：手机联网并同步成功前，云端原提醒继续生效。" : result.outcome === "created" ? "提醒已创建。" : result.outcome === "skipped" ? "已跳过本次。" : result.outcome === "cancelled" ? "提醒已取消。" : "提醒已更新。");
      onSaved?.(result.outcome);
    } catch (error) { setMessage(error instanceof Error && error.message.includes("version_conflict") ? "云端提醒已变化。你的修改已保留，请刷新后比较，再决定是否重新保存。" : error instanceof Error ? error.message : "保存失败，可重试。"); }
    finally { setBusy(false); }
  };
  const confirmSave = () => {
    if (isQuietTime(input.start_local.slice(11, 16), preferences.quietStart, preferences.quietEnd)) {
      Alert.alert("提醒位于聊天免打扰时段", "这条主动设置的提醒仍会按时通知；是否响铃由手机权限和系统勿扰设置决定。", [{ text: "再改一下", style: "cancel" }, { text: "保存提醒", onPress: () => void save(initial ? "edit" : "create") }]);
    } else void save(initial ? "edit" : "create");
  };
  return <Surface style={{ gap: 12 }}>
    <Text style={{ color: theme.text, fontWeight: "700", fontSize: 17 }}>{initial ? "修改提醒" : "设置提醒"}</Text>
    <Text style={{ color: theme.muted }}>提醒时间与事项截止时间分开，不填写就不会自动安排。</Text>
    <AppField label="提醒内容" value={input.content} onChangeText={content => patch({ content })} maxLength={2000} multiline />
    <AppField label="当地日期和时间" placeholder="2026-09-12T09:00" value={input.start_local} onChangeText={start_local => patch({ start_local })} autoCapitalize="none" />
    <AppField label="时区（保存后不会随设备改变）" value={input.timezone} onChangeText={timezone => patch({ timezone })} autoCapitalize="none" />
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{frequencies.map(([frequency, label]) => <Pressable key={frequency} accessibilityRole="button" accessibilityState={{ selected: input.rule.frequency === frequency }} onPress={() => rule({ frequency })} style={{ padding: 10, borderRadius: 8, backgroundColor: input.rule.frequency === frequency ? theme.secondary : theme.card, borderColor: theme.line, borderWidth: 1 }}><Text style={{ color: theme.text }}>{label}</Text></Pressable>)}</View>
    {input.rule.frequency === "weekly" ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{[1, 2, 3, 4, 5, 6, 7].map(day => <AppButton key={day} label={`周${"一二三四五六日"[day - 1]}`} variant={input.rule.weekdays?.includes(day) ? "primary" : "secondary"} onPress={() => rule({ weekdays: input.rule.weekdays?.includes(day) ? input.rule.weekdays.filter(v => v !== day) : [...input.rule.weekdays ?? [], day] })} />)}</View> : null}
    {input.rule.frequency === "weekdays" ? <Text style={{ color: theme.muted }}>工作日为周一至周五，不包含法定节假日和调休规则。</Text> : null}
    {input.rule.frequency === "monthly" ? <><AppField label="每月几号（1–31）" keyboardType="number-pad" value={String(input.rule.day ?? "")} onChangeText={value => rule({ day: Number(value) })} /><Text style={{ color: theme.muted }}>当月不存在该日期时，在当月最后一天提醒。</Text></> : null}
    {input.rule.frequency === "interval" ? <><AppField label="间隔数量" keyboardType="number-pad" value={String(input.rule.interval ?? "")} onChangeText={value => rule({ interval: Number(value) })} /><View style={{ flexDirection: "row", gap: 8 }}>{([['minute','分钟'],['hour','小时'],['day','天'],['week','周']] as const).map(([unit, label]) => <AppButton key={unit} label={label} variant={input.rule.unit === unit ? "primary" : "secondary"} onPress={() => rule({ unit })} />)}</View></> : null}
    {input.rule.frequency !== "once" ? <AppField label="结束日期（可不填，包含当天）" placeholder="YYYY-MM-DD" value={input.rule.until ?? ""} onChangeText={until => rule({ until: until || undefined })} /> : null}
    {initial ? <><View style={{ flexDirection: "row", gap: 8 }}>{([['only','本次'],['future','之后各次'],['all','整个系列']] as const).map(([value, label]) => <AppButton key={value} label={label} variant={scope === value ? "primary" : "secondary"} onPress={() => setScope(value)} />)}</View>{scope !== "all" ? <AppField label="原提醒实例时间" value={selected} onChangeText={setSelected} /> : null}</> : null}
    {message ? <Text accessibilityRole="alert" style={{ color: theme.text }}>{message}</Text> : null}
    <AppButton label={busy ? "正在保存…" : "保存提醒"} disabled={busy} onPress={confirmSave} />
    {initial ? <View style={{ gap: 8 }}><AppButton label="跳过选定本次" variant="secondary" disabled={busy} onPress={() => void save("skip")} /><AppButton label="取消提醒" variant="quiet" disabled={busy} onPress={() => void save("cancel")} /></View> : null}
  </Surface>;
}
