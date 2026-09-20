import AsyncStorage from "@react-native-async-storage/async-storage";
import { requireSupabase } from "../lib/supabase";
import { clearReminderCache } from "./reminders";

const deviceKey = (owner: string) => `pet-push-device-v2:${owner}`;
const statusKey = (owner: string) => `pet-push-status-v2:${owner}`;
const closingAccounts = new Set<string>();
export function isNotificationAccountClosing(owner: string): boolean { return closingAccounts.has(owner); }
export function openNotificationAccount(owner: string) { closingAccounts.delete(owner); }
export type PushRegistrationStatus = "registered" | "permission_denied" | "no_project_configuration" | "unsupported_device" | "registration_failed";
export async function currentPushDevice(owner: string): Promise<string | null> { return AsyncStorage.getItem(deviceKey(owner)); }
export async function savePushDevice(owner: string, deviceId: string) { await AsyncStorage.setItem(deviceKey(owner), deviceId); }
export async function savePushRegistrationStatus(owner: string, status: PushRegistrationStatus) { await AsyncStorage.setItem(statusKey(owner), status); }
export async function pushRegistrationStatus(owner: string): Promise<PushRegistrationStatus | null> { return AsyncStorage.getItem(statusKey(owner)) as Promise<PushRegistrationStatus | null>; }

/** Invoke while the previous account's access token is still available. */
export async function unregisterCurrentPushDevice(owner: string): Promise<void> {
  closingAccounts.add(owner);
  const deviceId = await currentPushDevice(owner);
  if (!deviceId) return;
  const result = await requireSupabase().rpc("unregister_push_device", { target_device: deviceId });
  if (result.error) { closingAccounts.delete(owner); throw new Error("设备推送解绑未完成，请联网后再退出，避免旧账号继续收到通知。"); }
  await AsyncStorage.removeItem(deviceKey(owner));
}
export async function clearNotificationLocalData(owner: string): Promise<void> {
  await clearReminderCache(owner);
  await AsyncStorage.multiRemove([deviceKey(owner), statusKey(owner), `pet-cohabitation-notifications-v1:${owner}`]);
}
export async function exportNotificationData(owner: string) {
  const client = requireSupabase();
  const [series, occurrences, deliveries, preferences, spacePreferences, devices] = await Promise.all([
    client.from("reminder_series").select("*").eq("owner_id", owner),
    client.from("reminder_occurrences").select("*"),
    client.from("notification_deliveries").select("*"),
    client.from("notification_preferences").select("*").eq("user_id", owner),
    client.from("space_notification_preferences").select("*").eq("user_id", owner),
    client.from("device_push_tokens").select("id,platform,enabled,permission_status,revoked_at,created_at,last_seen_at").eq("user_id", owner),
  ]);
  for (const result of [series, occurrences, deliveries, preferences, spacePreferences, devices]) if (result.error) throw result.error;
  return { reminder_series: series.data, reminder_occurrences: occurrences.data, notification_deliveries: deliveries.data, notification_preferences: preferences.data, space_notification_preferences: spacePreferences.data, notification_devices: devices.data };
}
export const NOTIFICATION_DELIVERY_LABELS: Record<string, string> = {
  queued: "等待提交推送", sending: "正在提交推送", ticket_accepted: "推送服务已受理，待查询回执", receipt_ok: "设备推送通道已接收，手机展示未核实", retry: "通道暂时失败，等待重试", failed: "推送通道失败", cancelled: "未投递", receipt_unknown: "投递结果无法核实",
};
export async function resolveNotificationTarget(eventId: string) {
  const { data, error } = await requireSupabase().rpc("resolve_notification_target", { target_event: eventId });
  if (error) throw error;
  return data as { state: "available" | "unavailable" | "forbidden" | "deleted" | "cancelled" | "completed"; route?: string; payload?: Record<string, unknown> };
}
