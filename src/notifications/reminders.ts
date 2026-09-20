import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { requireSupabase } from "../lib/supabase";
import { createRequestId } from "../lib/uuid";

export type ReminderRule = { frequency: "once" | "daily" | "weekly" | "weekdays" | "monthly" | "interval"; weekdays?: number[]; day?: number; interval?: number; unit?: "minute" | "hour" | "day" | "week"; until?: string };
export type ReminderInput = { content: string; timezone: string; start_local: string; rule: ReminderRule; work_item_id?: string | null };
export type ReminderSeries = ReminderInput & { id: string; owner_id: string; next_at: string | null; version: number; status: "active" | "ended" | "cancelled"; parent_id: string | null };
export type ReminderCommand = { action: "create" | "edit" | "cancel" | "skip"; request_id: string; series_id?: string; expected_version?: number; scope?: "only" | "future" | "all"; scheduled_at?: string; input?: Partial<ReminderInput> };
export type ReminderReceipt = { series: ReminderSeries; outcome: "created" | "updated" | "cancelled" | "skipped" };
export type PendingReminder = { command: ReminderCommand; state: "pending" | "conflict"; error?: string };
const cacheKey = (owner: string) => `pet-reminder-cache-v1:${owner}`;
const pendingKey = (owner: string) => `pet-reminder-pending-v1:${owner}`;
const locks = new Map<string, Promise<unknown>>();
const storageLocks = new Map<string, Promise<unknown>>();
async function changePending(owner: string, transform: (rows: PendingReminder[]) => PendingReminder[]): Promise<void> {
  const previous = storageLocks.get(owner) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    const rows = await pendingReminders(owner);
    await AsyncStorage.setItem(pendingKey(owner), JSON.stringify(transform(rows)));
  });
  storageLocks.set(owner, operation);
  try { await operation; } finally { if (storageLocks.get(owner) === operation) storageLocks.delete(owner); }
}

export function isQuietTime(time: string, start = "23:00", end = "08:00"): boolean {
  return start > end ? time >= start && time < "24:00" || time < end : time >= start && time < end;
}
export function validateReminder(input: ReminderInput): string | null {
  if (!input.content.trim() || input.content.trim().length > 2000) return "请填写 1–2000 字的提醒内容。";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(input.start_local)) return "时间格式为 YYYY-MM-DDTHH:mm。";
  const date = new Date(`${input.start_local}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 16) !== input.start_local.slice(0, 16)) return "请选择存在的日期和时间。";
  try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format(); } catch { return "请输入有效时区，例如 Asia/Shanghai。"; }
  if (input.rule.frequency === "weekly" && (!input.rule.weekdays?.length || input.rule.weekdays.some(day => day < 1 || day > 7))) return "请选择至少一个周几。";
  if (input.rule.frequency === "monthly" && (!Number.isInteger(input.rule.day) || input.rule.day! < 1 || input.rule.day! > 31)) return "每月日期应为 1–31。";
  if (input.rule.frequency === "interval" && (!Number.isInteger(input.rule.interval) || input.rule.interval! < 1 || input.rule.interval! > 10000 || !input.rule.unit)) return "请填写 1–10000 的间隔和单位。";
  if (input.rule.until && (!/^\d{4}-\d{2}-\d{2}$/.test(input.rule.until) || input.rule.until < input.start_local.slice(0, 10))) return "结束日期不能早于开始日期。";
  return null;
}
export async function pendingReminders(owner: string): Promise<PendingReminder[]> {
  const raw = await AsyncStorage.getItem(pendingKey(owner));
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}
async function assertOwner(owner: string) {
  const session = await requireSupabase().auth.getSession();
  if (session.data.session?.user.id !== owner) throw new Error("account_changed");
}
export async function submitReminder(owner: string, command: ReminderCommand): Promise<ReminderReceipt | { outcome: "pending_sync" }> {
  await assertOwner(owner);
  // Persist the exact immutable request before any network attempt. A lost HTTP
  // response or closed app can safely replay the same request id.
  await changePending(owner, pending => {
    const previous = pending.find(row => row.command.request_id === command.request_id);
    if (previous && JSON.stringify(previous.command) !== JSON.stringify(command)) throw new Error("request_content_mismatch");
    return previous ? pending : [...pending, { command, state: "pending" }];
  });
  const network = await NetInfo.fetch();
  if (network.isConnected === false || network.isInternetReachable === false) return { outcome: "pending_sync" };
  const result = await requireSupabase().rpc("manage_reminder", { command });
  await assertOwner(owner);
  if (result.error) {
    if (!result.error.code || /fetch|network|timeout|Failed to fetch/i.test(result.error.message)) return { outcome: "pending_sync" };
    await changePending(owner, pending => pending.map(row => row.command.request_id === command.request_id ? { ...row, state: "conflict", error: result.error.message } : row));
    throw new Error(result.error.message);
  }
  await changePending(owner, pending => pending.filter(row => row.command.request_id !== command.request_id));
  return result.data as ReminderReceipt;
}
export async function syncPendingReminders(owner: string): Promise<void> {
  const previous = locks.get(owner);
  if (previous) { await previous; return; }
  const operation = (async () => {
    for (const row of await pendingReminders(owner)) {
      if (row.state === "conflict") continue;
      try { const result = await submitReminder(owner, row.command); if (result.outcome === "pending_sync") break; } catch { /* Keep local conflict for explicit resolution. */ }
    }
  })();
  locks.set(owner, operation);
  try { await operation; } finally { locks.delete(owner); }
}
export async function discardPendingReminder(owner: string, requestId: string) {
  await changePending(owner, pending => pending.filter(row => row.command.request_id !== requestId));
}
export async function listReminders(owner: string): Promise<{ series: ReminderSeries[]; cached: boolean }> {
  await assertOwner(owner);
  const result = await requireSupabase().from("reminder_series").select("*").eq("owner_id", owner).order("created_at", { ascending: false }).limit(100);
  await assertOwner(owner);
  if (result.error) {
    const raw = await AsyncStorage.getItem(cacheKey(owner));
    return { series: raw ? JSON.parse(raw) : [], cached: true };
  }
  await AsyncStorage.setItem(cacheKey(owner), JSON.stringify(result.data));
  return { series: result.data as ReminderSeries[], cached: false };
}
export const newReminderRequestId = createRequestId;
export async function clearReminderCache(owner: string) { await AsyncStorage.multiRemove([cacheKey(owner), pendingKey(owner)]); }
