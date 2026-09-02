import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function easProjectId(): string | null {
  return Constants.easConfig?.projectId
    ?? (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId
    ?? null;
}

export function NotificationBootstrap() {
  const { profile, isLocalDemo } = useSession();

  useEffect(() => {
    if (!profile || isLocalDemo || !Device.isDevice) return;
    let active = true;
    const register = async () => {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("messages", {
          name: "消息与提醒",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 180, 100, 180],
          lightColor: "#FF806F",
        });
      }
      const current = await Notifications.getPermissionsAsync();
      const permission = current.status === "granted" ? current : await Notifications.requestPermissionsAsync();
      const projectId = easProjectId();
      if (!active || permission.status !== "granted" || !projectId) return;
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      if (!active) return;
      await requireSupabase().rpc("register_push_token", {
        expo_token: token,
        device_label: Device.deviceName ?? Device.modelName ?? "Android device",
        device_platform: Platform.OS,
      });
    };
    void register().catch(() => undefined);
    return () => { active = false; };
  }, [isLocalDemo, profile]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = response.notification.request.content.data?.route;
      if (typeof route === "string" && route.startsWith("/")) router.push(route as never);
    });
    return () => subscription.remove();
  }, []);

  return null;
}
