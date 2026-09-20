import { useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";
import { useAppTheme } from "../theme/ThemeProvider";
import { AppButton, AppField, Surface } from "../ui/common";
import { pushRegistrationStatus } from "./lifecycle";
import { useNotificationPreferences } from "./preferences";

type PreferencesState=ReturnType<typeof useNotificationPreferences>;
export function NotificationSettings(props:{spaceId?:string;state?:PreferencesState}){
 const {profile}=useSession(); const key=`${profile?.id}:${props.spaceId}`;
 return props.state?<NotificationSettingsContent key={key} spaceId={props.spaceId} state={props.state}/>:<ConnectedNotificationSettings key={key} spaceId={props.spaceId}/>;
}
function ConnectedNotificationSettings({spaceId}:{spaceId?:string}){const state=useNotificationPreferences();return <NotificationSettingsContent spaceId={spaceId} state={state}/>;}
function NotificationSettingsContent({ spaceId,state }: { spaceId?: string;state:PreferencesState }) {
  const { profile, isLocalDemo } = useSession();
  const { theme } = useAppTheme();
  const { preferences, update, save, saving } = state;
  const [quietStart, setQuietStart] = useState(preferences.quietStart);
  const [quietEnd, setQuietEnd] = useState(preferences.quietEnd);
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const [muted, setMuted] = useState<boolean | null>(null), [muteBusy, setMuteBusy] = useState(false);
  const identity = `${profile?.id}:${spaceId}`; const current = useRef(identity); current.current = identity;
  useEffect(() => { setQuietStart(preferences.quietStart); setQuietEnd(preferences.quietEnd); }, [preferences.quietStart, preferences.quietEnd]);
  useEffect(() => {
    let active = true;
    setStatus(""); setMessage("");
    const refresh = () => { if (profile) void pushRegistrationStatus(profile.id).then(value => { if (active) setStatus(value ?? "not_registered"); }).catch(() => { if (active) setStatus("not_registered"); }); };
    refresh(); const listener = AppState.addEventListener("change", value => { if (value === "active") refresh(); });
    return () => { active = false; listener.remove(); };
  }, [profile?.id]);
  useEffect(() => {
    let active = true; setMuted(null); setMessage(""); setMuteBusy(false);
    if (profile && spaceId && !isLocalDemo) void requireSupabase().from("space_notification_preferences").select("muted_until").eq("user_id", profile.id).eq("space_id", spaceId).maybeSingle().then(result => { if (active) { if (result.error) setMessage("此群当前静音状态暂未核实，请联网重试。"); else setMuted(Boolean(result.data?.muted_until && Date.parse(result.data.muted_until) > Date.now())); } });
    return () => { active = false; };
  }, [profile?.id, spaceId, isLocalDemo]);
  const mute = async (muted: boolean) => {
    if (!profile || !spaceId || isLocalDemo || muteBusy) return;
    setMuteBusy(true);
    try {
      const result = await requireSupabase().from("space_notification_preferences").upsert({ user_id: profile.id, space_id: spaceId, muted_until: muted ? "9999-12-31T00:00:00Z" : null });
      if (current.current !== identity) return; if (result.error) throw result.error;
      setMuted(muted); setMessage(muted ? "此群已静音。" : "已恢复此群通知。");
    } catch { if (current.current === identity) setMessage("保存失败，请联网重试。"); }
    finally { if (current.current === identity) setMuteBusy(false); }
  };
  const saveSettings = async () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(quietStart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quietEnd)) { setMessage("请填写有效的 HH:mm 时间，再保存通知设置。"); return; }
    try { new Intl.DateTimeFormat("zh-CN", { timeZone: preferences.timezone }).format(); } catch { setMessage("请填写有效时区，例如 Asia/Shanghai。"); return; }
    try { await save(); if (current.current === identity) setMessage("通知设置已保存。"); } catch { if (current.current === identity) setMessage("保存失败，云端原设置继续生效。"); }
  };
  return <Surface style={{ gap: 12 }}>
    <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>通知与免打扰</Text>
    <Text style={{ color: theme.muted }}>{({ registered: "设备已注册，手机实际展示仍由系统决定。", permission_denied: "手机通知权限未开启。", no_project_configuration: "当前安装包缺少推送项目配置。", unsupported_device: "此设备无法注册原生推送。", registration_failed: "设备推送注册失败，请联网重开应用重试。", not_registered: "尚无有效设备注册。" } as Record<string, string>)[status]}</Text>
    <AppField label="聊天免打扰开始（HH:mm）" value={quietStart} onChangeText={value => { setQuietStart(value); if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) update({ quietStart: value }); }} />
    <AppField label="聊天免打扰结束（HH:mm）" value={quietEnd} onChangeText={value => { setQuietEnd(value); if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) update({ quietEnd: value }); }} />
    <AppField label="免打扰时区" value={preferences.timezone} onChangeText={timezone => update({ timezone })} autoCapitalize="none" />
    <Text style={{ color: theme.muted }}>免打扰时段内聊天不响、不震；主动设置的提醒仍按提醒设置执行。标题和正文默认隐藏具体内容。</Text>
    <AppButton label={preferences.showContentPreview ? "锁屏内容预览：已开启" : "锁屏内容预览：关闭"} variant="secondary" onPress={() => update({ showContentPreview: !preferences.showContentPreview })} />
    <AppButton label={saving ? "保存中…" : "保存通知设置"} disabled={saving} onPress={() => void saveSettings()} />
    {spaceId ? <View style={{ gap: 8 }}><Text style={{ color: theme.muted }}>{muted === null ? "此群静音状态尚未核实。" : muted ? "此群当前已静音。" : "此群当前允许通知。"}</Text><AppButton label="静音此群" variant="secondary" disabled={muteBusy} onPress={() => void mute(true)} /><AppButton label="恢复此群通知" variant="quiet" disabled={muteBusy} onPress={() => void mute(false)} /></View> : null}
    {message ? <Text accessibilityRole="alert" style={{ color: theme.text }}>{message}</Text> : null}
  </Surface>;
}
