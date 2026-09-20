import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { AppButton, Surface } from "../ui/common";
import { ReminderEditor } from "./ReminderEditor";
import { discardPendingReminder, listReminders, pendingReminders, syncPendingReminders, type PendingReminder, type ReminderSeries } from "./reminders";

/** Embed below a work item or in the personal reminders entry. */
export function ReminderManager({ itemId, title = "" }: { itemId?: string; title?: string }) {
  const { profile, isLocalDemo } = useSession();
  const { theme } = useAppTheme();
  const [series, setSeries] = useState<ReminderSeries[]>([]);
  const [pending, setPending] = useState<PendingReminder[]>([]);
  const [selected, setSelected] = useState<ReminderSeries | "new" | null>(null);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState("");
  const ownerRef = useRef(profile?.id); ownerRef.current = profile?.id;
  const [viewOwner, setViewOwner] = useState(profile?.id);
  const reload = useCallback(async () => {
    if (!profile || isLocalDemo) return;
    try {
      await syncPendingReminders(profile.id);
      const result = await listReminders(profile.id);
      const local = await pendingReminders(profile.id);
      if (ownerRef.current !== profile.id) return;
      setSeries(result.series.filter(row => !itemId || row.work_item_id === itemId)); setCached(result.cached);
      setPending(local); setError(""); setViewOwner(profile.id);
    } catch { if (ownerRef.current === profile.id) setError("提醒暂时无法同步。已保留本地修改。"); }
  }, [profile?.id, itemId, isLocalDemo]);
  useEffect(() => {
    setSeries([]); setPending([]); setSelected(null); setViewOwner(profile?.id); void reload();
    return NetInfo.addEventListener(state => { if (state.isConnected && state.isInternetReachable !== false) void reload(); });
  }, [reload]);
  return <View style={{ gap: 12 }}>
    <AppButton label="设置自己的提醒" variant="secondary" onPress={() => setSelected("new")} />
    {cached ? <Text style={{ color: theme.muted }}>显示本账号缓存，尚未核实最新状态和权限。</Text> : null}
    {error ? <Text style={{ color: theme.text }}>{error}</Text> : null}
    {(viewOwner === profile?.id ? pending : []).map(row => <Surface key={row.command.request_id} style={{ gap: 8 }}>
      <Text style={{ color: theme.text }}>{row.state === "conflict" ? "需要处理同步冲突" : "提醒待同步"}</Text>
      <Text selectable style={{ color: theme.muted }}>{row.command.input?.content ?? row.command.action} · {row.command.input?.start_local ?? row.command.scheduled_at ?? ""}</Text>
      <Text style={{ color: theme.muted }}>同步成功前云端原提醒继续生效。{row.error ? "云端内容或权限已变化，请刷新后重新编辑。" : ""}</Text>
      <AppButton label="刷新云端状态" variant="quiet" onPress={() => void reload()} />
      <AppButton label="放弃这份本地修改" variant="quiet" onPress={() => profile && void discardPendingReminder(profile.id, row.command.request_id).then(reload)} />
    </Surface>)}
    {(viewOwner === profile?.id ? series : []).map(row => <Surface key={row.id} style={{ gap: 8 }}>
      <Text style={{ color: theme.text, fontWeight: "600" }}>{row.content}</Text>
      <Text style={{ color: theme.muted }}>{row.status === "cancelled" ? "已取消" : row.next_at ? `下次：${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: row.timezone }).format(new Date(row.next_at))}（${row.timezone}）` : "本系列已无后续提醒"}</Text>
      {row.status !== "cancelled" ? <AppButton label="编辑、跳过或取消" variant="quiet" onPress={() => setSelected(row)} /> : null}
    </Surface>)}
    {selected && viewOwner === profile?.id ? <><ReminderEditor key={typeof selected === "string" ? "new" : `${selected.id}:${selected.version}`} itemId={itemId} initialTitle={title} initial={typeof selected === "string" ? undefined : selected} onSaved={outcome => { if (outcome !== "pending_sync") setSelected(null); void reload(); }} /><AppButton label="收起提醒编辑" variant="quiet" onPress={() => setSelected(null)} /></> : null}
  </View>;
}
