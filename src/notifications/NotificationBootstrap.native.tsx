import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router, usePathname } from "expo-router";
import { useEffect, useRef } from "react";
import { Alert, AppState, Platform } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";
import { currentPushDevice, isNotificationAccountClosing, openNotificationAccount, resolveNotificationTarget, savePushDevice, savePushRegistrationStatus } from "./lifecycle";
import { syncPendingReminders } from "./reminders";

let foregroundContext: { owner: string | null; route: string } = { owner: null, route: "" };
Notifications.setNotificationHandler({
  handleNotification: async notification => {
    const data = notification.request.content.data ?? {};
    const wrongAccount = !foregroundContext.owner || data.recipient_id !== foregroundContext.owner;
    const visibleChat = ["message", "mention", "agent_result"].includes(String(data.kind)) && foregroundContext.route === String(data.route ?? "").split("?")[0] && AppState.currentState === "active";
    const suppress = wrongAccount || visibleChat;
    return { shouldShowBanner: !suppress, shouldShowList: !suppress, shouldPlaySound: !suppress && data.silent !== true, shouldSetBadge: !suppress };
  },
});

export function NotificationBootstrap() {
  const { profile, isLocalDemo } = useSession();
  const pathname = usePathname();
  const current = useRef({ owner: profile?.id, route: pathname });
  current.current = { owner: profile?.id, route: pathname };
  foregroundContext = { owner: profile?.id ?? null, route: pathname };

  useEffect(() => {
    const owner = profile?.id;
    if (!owner || isLocalDemo) return;
    openNotificationAccount(owner);
    if (!Device.isDevice) { void savePushRegistrationStatus(owner, "unsupported_device"); return; }
    let active = true;
    let registering = false;
    const presence = async () => {
      const deviceId = await currentPushDevice(owner);
      if (!active || !deviceId || current.current.owner !== owner) return;
      const permission = await Notifications.getPermissionsAsync();
      if (!active) return;
      await requireSupabase().rpc("update_push_device_presence", {
        target_device: deviceId, current_route: AppState.currentState === "active" ? current.current.route : null,
        permission: permission.granted ? "granted" : permission.status === "denied" ? "denied" : "undetermined",
      });
      if (!permission.granted) await savePushRegistrationStatus(owner, "permission_denied");
    };
    const register = async () => {
      if (registering || isNotificationAccountClosing(owner)) return;
      registering = true;
      try {
        if (Platform.OS === "android") {
          for (const [id, name, silent] of [["messages-v2", "聊天消息", false], ["chat-silent-v2", "免打扰聊天", true], ["reminders-v2", "本人设置的提醒", false]] as const) {
            await Notifications.setNotificationChannelAsync(id, { name, importance: silent ? Notifications.AndroidImportance.LOW : Notifications.AndroidImportance.HIGH,
              sound: silent ? null : "default", enableVibrate: !silent, vibrationPattern: silent ? [0] : [0, 180, 100, 180],
              lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE, bypassDnd: false });
          }
        }
        const existing = await Notifications.getPermissionsAsync();
        const permission = existing.granted ? existing : await Notifications.requestPermissionsAsync();
        if (!active || current.current.owner !== owner || isNotificationAccountClosing(owner)) return;
        if (!permission.granted) { await savePushRegistrationStatus(owner, "permission_denied"); await presence(); return; }
        const projectId = Constants.easConfig?.projectId ?? (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
        if (!projectId) { await savePushRegistrationStatus(owner, "no_project_configuration"); return; }
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        if (!active || current.current.owner !== owner || isNotificationAccountClosing(owner)) return;
        const previousDevice = await currentPushDevice(owner);
        const session = (await requireSupabase().auth.getSession()).data.session;
        if (session?.user.id !== owner || isNotificationAccountClosing(owner)) return;
        const result = await requireSupabase().rpc("register_push_device_v2", { expo_token: token, device_label: Device.deviceName ?? Device.modelName ?? "Android device", device_platform: Platform.OS, previous_device: previousDevice });
        if (result.error) throw result.error;
        if (!active || current.current.owner !== owner || isNotificationAccountClosing(owner)) {
          // A registration response can race logout. Revoke using the captured
          // previous session, never the newly signed-in account's token.
          await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL?.trim()}/rest/v1/rpc/unregister_push_device`, { method: "POST", headers: { apikey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "", Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ target_device: result.data }) });
          return;
        }
        await savePushDevice(owner, result.data);
        await savePushRegistrationStatus(owner, "registered");
        await presence();
      } catch { if (active) await savePushRegistrationStatus(owner, "registration_failed"); }
      finally { registering = false; }
    };
    void register();
    const ticker = setInterval(() => { if (AppState.currentState === "active") void presence().catch(() => undefined); }, 30000);
    const state = AppState.addEventListener("change", next => {
      void presence().catch(() => undefined);
      if (next === "active") { void register(); void syncPendingReminders(owner); }
    });
    const rotated = Notifications.addPushTokenListener(() => { void register(); });
    return () => { active = false; clearInterval(ticker); state.remove(); rotated.remove(); };
  }, [profile?.id, isLocalDemo]);

  useEffect(() => {
    const owner = profile?.id;
    if (!owner || isLocalDemo) return;
    void currentPushDevice(owner).then(deviceId => {
      if (deviceId && current.current.owner === owner) return requireSupabase().rpc("update_push_device_presence", { target_device: deviceId, current_route: AppState.currentState === "active" ? pathname : null });
    }).catch(() => undefined);
  }, [profile?.id, pathname, isLocalDemo]);

  useEffect(() => {
    const owner = profile?.id;
    if (!owner || isLocalDemo) return;
    let active = true;
    const handled = new Set<string>();
    const open = async (response: Notifications.NotificationResponse | null) => {
      if (!response || !active) return;
      const data = response.notification.request.content.data ?? {};
      const id = data.notification_event_id;
      if (typeof id !== "string" || handled.has(id) || (data.recipient_id && data.recipient_id !== owner)) return;
      handled.add(id);
      try {
        const target = await resolveNotificationTarget(id);
        if (!active || current.current.owner !== owner) return;
        if (target.state !== "available") {
          Alert.alert("通知状态已变化", ({ unavailable: "原通知已不可用。", forbidden: "你已无权访问这条内容。", deleted: "原内容已删除。", cancelled: "这项安排已经取消。", completed: "这项事项已经完成。" } as Record<string, string>)[target.state]);
        }
        if (target.route && ["available", "completed"].includes(target.state) && /^\/(chat\/[^/?]+|pet|items)(\?|$)/.test(target.route)) router.push(target.route as never);
        await Notifications.clearLastNotificationResponseAsync();
      } catch { handled.delete(id); Alert.alert("暂时无法打开", "请联网后从通知列表重试，尚未核实最新权限。"); }
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(response => { void open(response); });
    void Notifications.getLastNotificationResponseAsync().then(open);
    return () => { active = false; subscription.remove(); };
  }, [profile?.id, isLocalDemo]);
  return null;
}
