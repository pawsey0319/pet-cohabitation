import { NotificationSettings } from "../../src/notifications/NotificationSettings";
import { AvatarEditor } from "../../src/avatars/AvatarEditor";
import { AvatarImage } from "../../src/avatars/AvatarImage";
import { ChatBackgroundEditor } from "../../src/backgrounds/ChatBackgroundEditor";
import { useChatBackground } from "../../src/backgrounds/ChatBackgroundProvider";
import { SettingsRow } from "../../src/ui/SettingsRow";
import { Icon } from "../../src/ui/Icon";
import { readableInk } from "../../src/theme/palette";
import { createThemedStyles } from "../../src/theme/themedStyles";
import { localDataKeys } from "../../src/data/localData";
import { savePrivateDraft } from "../../src/pets/privateDraft";
import { KeyboardScreen, KeyboardScrollView, KeyboardTextInput } from "../../src/components/KeyboardLayout";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAIProviderHealth } from "../../src/ai/health";
import { useSession } from "../../src/auth/SessionProvider";
import { exportJsonFile } from "../../src/dataExport/exportJson";
import { requireSupabase } from "../../src/lib/supabase";
import { useNotificationPreferences } from "../../src/notifications/preferences";
import {
  APP_INVALID_BACKUP_KEY,
  APP_STORAGE_KEY,
} from "../../src/state/AppState";
import {
  THEME_PRESETS,
  isHexColor,
  type PetReplyStyle,
  type ThemePreferences,
} from "../../src/theme/preferences";
import { useAppTheme } from "../../src/theme/ThemeProvider";
import { colors, spacing } from "../../src/theme/tokens";
import { AppButton, DemoBanner, Surface } from "../../src/ui/common";

const COLOR_FIELDS: readonly {
  key: keyof Pick<
    ThemePreferences,
    | "pageBackground"
    | "cardBackground"
    | "primaryButton"
    | "secondaryButton"
    | "dangerButton"
    | "accent"
  >;
  label: string;
  note: string;
}[] = [
  { key: "pageBackground", label: "页面背景", note: "所有主页面" },
  { key: "cardBackground", label: "卡片背景", note: "面板与底栏" },
  { key: "primaryButton", label: "主按钮", note: "发送与确认" },
  { key: "secondaryButton", label: "次按钮", note: "辅助操作" },
  { key: "dangerButton", label: "危险按钮", note: "注销等操作" },
  { key: "accent", label: "强调色", note: "选中与状态" },
];

const REPLY_STYLES: readonly {
  value: PetReplyStyle;
  label: string;
  note: string;
}[] = [
  { value: "concise", label: "简洁", note: "先结论，最多 3 个要点" },
  { value: "balanced", label: "均衡", note: "结论清楚，保留必要细节" },
  { value: "detailed", label: "详细", note: "适合长群聊与完整回顾" },
];

function Choice<T extends string>({
  value,
  current,
  label,
  note,
  onPress,
}: Readonly<{
  value: T;
  current: T;
  label: string;
  note?: string;
  onPress(value: T): void;
}>) {
  const { styles, colors } = useStyles();
  const { theme } = useAppTheme();
  const active = value === current;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(value)}
      style={[
        styles.choice,
        {
          borderColor: active ? theme.accent : theme.line,
          backgroundColor: active ? theme.secondary : "transparent",
          borderRadius: theme.radius,
        },
      ]}
    >
      <Text style={[styles.choiceLabel, active && { color: theme.accent }]}>
        {label}
      </Text>
      {note ? <Text style={styles.choiceNote}>{note}</Text> : null}
    </Pressable>
  );
}

function ColorControl({
  field,
  value,
  onValidChange,
}: Readonly<{
  field: (typeof COLOR_FIELDS)[number];
  value: string;
  onValidChange(value: string): void;
}>) {
  const { styles, colors } = useStyles();
  const { theme } = useAppTheme();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const valid = isHexColor(draft);
  return (
    <View style={styles.colorControl}>
      <View style={styles.colorHead}>
        <View
          style={[styles.colorChip, { backgroundColor: valid ? draft : value }]}
        />
        <View>
          <Text style={styles.colorLabel}>{field.label}</Text>
          <Text style={styles.colorNote}>{field.note}</Text>
        </View>
      </View>
      <KeyboardTextInput
        accessibilityLabel={field.label}
        autoCapitalize="characters"
        value={draft}
        onChangeText={(next) => {
          setDraft(next);
          if (isHexColor(next)) onValidChange(next);
        }}
        style={[
          styles.hexInput,
          {
            borderColor: valid ? theme.line : theme.danger,
            borderRadius: theme.radius,
          },
        ]}
      />
      {!valid ? (
        <Text style={[styles.colorNote, { color: theme.danger }]}>
          请输入 # 加 6 位十六进制颜色
        </Text>
      ) : null}
    </View>
  );
}

export default function MeScreen() {
  const { styles, colors } = useStyles();
  const { profile, logout, isLocalDemo } = useSession();
  const { clearLocalData:clearBackgroundData }=useChatBackground();
  const { preferences, theme, dirty, saving, update, replace, save, reset } =
    useAppTheme();
  const notificationState=useNotificationPreferences();
  const {
    preferences: notificationPreferences,
    dirty: notificationsDirty,
    saving: notificationsSaving,
    update: updateNotifications,
    save: saveNotifications,
    reset: resetNotifications,
  } = notificationState;
  const {
    health: aiHealth,
    checking: checkingAI,
    refresh: refreshAI,
  } = useAIProviderHealth();
  const insets = useSafeAreaInsets();
  const [legacyCleared, setLegacyCleared] = useState(false);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [pane,setPane]=useState<"home"|"appearance"|"notifications"|"reply"|"account"|"service">("home");
  const [backgroundOpen,setBackgroundOpen]=useState(false);
  const [avatarOpen,setAvatarOpen]=useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");

  const signOut = async () => {
    await logout();
    router.replace("/login");
  };
  const clearLegacy = async () => {
    await AsyncStorage.multiRemove([APP_STORAGE_KEY, APP_INVALID_BACKUP_KEY]);
    setLegacyCleared(true);
  };
  const persist = async () => {
    setSaveMessage(null);
    try {
      await Promise.all([save(), saveNotifications()]);
      setSaveMessage(isLocalDemo ? "已保存在此设备" : "已保存到你的账号");
    } catch (reason) {
      setSaveMessage(reason instanceof Error ? reason.message : "保存失败");
    }
  };
  const exportData = async () => {
    setDataBusy(true);
    setDataMessage(null);
    try {
      if (isLocalDemo) {
        const keys = await localDataKeys(profile!.id);
        const rows = await AsyncStorage.multiGet(keys);
        await exportJsonFile({
          exported_at: new Date().toISOString(),
          local_demo: true,
          data: Object.fromEntries(
            rows.map(([key, value]) => [key, value ? JSON.parse(value) : null]),
          ),
        }, `pet-cohabitation-export-${new Date().toISOString().slice(0, 10)}.json`);
      } else {
        const { data, error } = await requireSupabase().functions.invoke(
          "export-my-data",
          { body: {} },
        );
        if (error) throw error;
        await exportJsonFile(data, `pet-cohabitation-export-${new Date().toISOString().slice(0, 10)}.json`);
      }
      setDataMessage("导出文件已生成");
    } catch (reason) {
      setDataMessage(reason instanceof Error ? reason.message : "导出失败");
    } finally {
      setDataBusy(false);
    }
  };
  const deleteAccount = async () => {
    setDataBusy(true);
    setDataMessage(null);
    try {
      if (isLocalDemo) {
        const keys = await localDataKeys(profile!.id);
        await AsyncStorage.multiRemove(keys);
      } else {
        const { error } = await requireSupabase().functions.invoke(
          "delete-account",
          { body: { password } },
        );
        if (error) throw error;
      }
      await clearBackgroundData();
      if (profile) await savePrivateDraft(profile.id, null);
      await logout().catch(() => undefined);
      if(profile)await AsyncStorage.multiRemove([`pet-cohabitation-theme-v1:${profile.id}`,`pet-cohabitation-notifications-v1:${profile.id}`]);
      setDeleting(false);
      router.replace("/login");
    } catch (reason) {
      setDataMessage(reason instanceof Error ? reason.message : "注销失败");
    } finally {
      setDataBusy(false);
    }
  };

  return (
    <KeyboardScreen style={{ flex: 1 }}><KeyboardScrollView
      style={[styles.page, { backgroundColor: theme.page }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {isLocalDemo ? <DemoBanner /> : null}
      <View style={styles.topline}>
        {pane !== "home" ? <Pressable accessibilityRole="button" accessibilityLabel="返回设置" onPress={()=>setPane("home")} style={{minWidth:48,minHeight:48,justifyContent:"center"}}><Icon name="back" color={theme.text}/></Pressable> : null}
        <Text style={[styles.title,{fontSize:20}]}>{({home:"我的",appearance:"外观与显示",notifications:"消息通知",reply:"回应偏好",account:"账号与隐私",service:"AI 服务状态"})[pane]}</Text>
      </View>
      {pane === "home" ? <>
        <View style={{flexDirection:"row",alignItems:"center",gap:16,paddingVertical:20}}><Pressable accessibilityRole="button" accessibilityLabel="编辑个人头像" onPress={()=>setAvatarOpen(true)}><AvatarImage reference={profile?.avatarUrl} name={profile?.nickname??"我"} size={54}/></Pressable><View style={{flex:1,gap:6}}><Text style={{fontSize:21,fontWeight:"600",color:theme.text}}>{profile?.nickname}</Text><Text style={{fontSize:13,color:theme.muted}}>{profile?.email ?? "本地体验"}</Text></View></View>
        <View style={{borderRadius:12,overflow:"hidden"}}>
          <SettingsRow title="个人头像" note="相册裁切、AI 设计与恢复默认" icon="user" onPress={()=>setAvatarOpen(true)}/>
          <SettingsRow title="外观与显示" note="浅色、深色与跟随系统" icon="sun" onPress={()=>setPane("appearance")}/>
          <SettingsRow title="聊天背景" note="推荐背景、上传图片、AI 设计" icon="image" onPress={()=>setBackgroundOpen(true)}/>
          <SettingsRow title="回应偏好" icon="pet" onPress={()=>setPane("reply")}/>
          <SettingsRow title="消息通知" icon="messages" onPress={()=>setPane("notifications")}/>
          <SettingsRow title="账号与隐私" icon="shield" onPress={()=>setPane("account")}/>
          <SettingsRow title="AI 服务状态" icon="settings" onPress={()=>setPane("service")}/>
        </View>
      </> : null}

      {pane === "service" ? (<Surface style={styles.healthCard}>
        <View style={styles.healthCopy}>
          <Text style={styles.sectionKicker}>连接状态</Text>
          <Text style={styles.healthTitle}>
            {checkingAI ? "正在检查服务" : aiHealth.statusCode === "mock" ? "演示模式" : aiHealth.statusCode === "unknown" ? "本次检查未完成" : aiHealth.textCheck === "generation" ? "文本试调用成功" : aiHealth.textCheck === "failed" ? "文本服务暂不可用" : "已检查接口连接"}
          </Text>
          <Text style={styles.controlNote}>
            {aiHealth.statusCode === "unknown" ? "请重新检查，未沿用旧状态。" : aiHealth.statusCode === "mock" ? "当前为演示回复。" :               `文本：${aiHealth.textCheck === "generation" ? "试调用通过" : aiHealth.textCheck === "failed" ? "试调用失败" : "仅检查连接"} · 图片：${aiHealth.imageOnline ? "模型目录可达，生成未验证" : "连接未通过"}`}
            {aiHealth.checkedAt
              ? ` · ${new Date(aiHealth.checkedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 检查`
              : ""}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={checkingAI}
          onPress={() => void refreshAI()}
          style={[
            styles.healthButton,
            { borderColor: theme.line, borderRadius: theme.radius },
          ]}
        >
          <Text style={[styles.healthButtonText, { color: theme.accent }]}>
            {checkingAI ? "检查中" : "重新检查"}
          </Text>
        </Pressable>
      </Surface>) : null}

      {pane === "appearance" ? (<Surface style={styles.section}>
        <View style={styles.sectionHead}>
          <View>
            <Text style={styles.sectionKicker}>外观</Text>
            <Text style={styles.sectionTitle}>选择一个氛围</Text>
          </View>
          <Text style={styles.sectionAside}>实时预览</Text>
        </View>
        <View style={styles.presetGrid}>
          {THEME_PRESETS.map((preset) => {
            const active =
              preferences.appearance === preset.value.appearance;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`使用${preset.name}主题`}
                key={preset.id}
                onPress={() =>
                  replace({
                    ...preset.value,
                    petReplyStyle: preferences.petReplyStyle,
                    reduceMotion: preferences.reduceMotion,
                  })
                }
                style={[
                  styles.preset,
                  {
                    backgroundColor: preset.value.pageBackground,
                    borderColor: active ? theme.accent : theme.line,
                    borderRadius: theme.radius,
                  },
                ]}
              >
                <View style={styles.swatches}>
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: preset.value.primaryButton },
                    ]}
                  />
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: preset.value.secondaryButton },
                    ]}
                  />
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: preset.value.accent },
                    ]}
                  />
                </View>
                <Text style={[styles.presetName,{color:readableInk(preset.value.pageBackground)}]}>{preset.name}</Text>
                <Text style={[styles.presetNote,{color:readableInk(preset.value.pageBackground),opacity:.65}]}>{preset.note}</Text>
              </Pressable>
            );
          })}
        </View>
        <View
          style={[
            styles.preview,
            {
              backgroundColor: theme.page,
              borderColor: theme.line,
              borderRadius: theme.radius + 5,
            },
          ]}
        >
          <View
            style={[
              styles.previewCard,
              { backgroundColor: theme.card, borderRadius: theme.radius },
            ]}
          >
            <View style={styles.previewLine}>
              <View>
                <Text style={styles.previewTitle}>今晚碰个面</Text>
                <Text style={styles.previewCopy}>异宠整理了 3 条新消息</Text>
              </View>
              <View
                style={[styles.previewDot, { backgroundColor: theme.accent }]}
              />
            </View>
            <View style={styles.previewButtons}>
              <View
                style={[
                  styles.previewButton,
                  {
                    backgroundColor: theme.primary,
                    borderRadius: theme.radius,
                  },
                ]}
              >
                <Text style={styles.previewButtonText}>去看看</Text>
              </View>
              <View
                style={[
                  styles.previewButton,
                  {
                    backgroundColor: theme.secondary,
                    borderRadius: theme.radius,
                  },
                ]}
              >
                <Text style={[styles.previewButtonText,{color:theme.text}]}>稍后</Text>
              </View>
            </View>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setAdvancedOpen((value) => !value)}
          style={styles.disclosure}
        >
          <Text style={styles.disclosureText}>精细调整颜色</Text>
          <Text style={[styles.disclosureIcon, { color: theme.accent }]}>
            {advancedOpen ? "−" : "+"}
          </Text>
        </Pressable>
        {advancedOpen ? (
          <View style={styles.colorGrid}>
            {COLOR_FIELDS.map((field) => (
              <ColorControl
                key={field.key}
                field={field}
                value={preferences[field.key]}
                onValidChange={(value) =>
                  update({ [field.key]: value, appearance:"custom" } as Partial<ThemePreferences>)
                }
              />
            ))}
          </View>
        ) : null}
      </Surface>) : null}

      {pane === "appearance" ? (<Surface style={styles.section}>
        <View style={styles.sectionHead}>
          <View>
            <Text style={styles.sectionKicker}>显示</Text>
            <Text style={styles.sectionTitle}>界面手感</Text>
          </View>
        </View>
        <Text style={styles.controlLabel}>按钮与卡片圆角</Text>
        <View style={styles.choiceRow}>
          <Choice
            value="compact"
            current={preferences.cornerStyle}
            label="利落"
            onPress={(cornerStyle) => update({ cornerStyle })}
          />
          <Choice
            value="soft"
            current={preferences.cornerStyle}
            label="柔和"
            onPress={(cornerStyle) => update({ cornerStyle })}
          />
          <Choice
            value="round"
            current={preferences.cornerStyle}
            label="圆润"
            onPress={(cornerStyle) => update({ cornerStyle })}
          />
        </View>
        <Text style={styles.controlLabel}>信息密度</Text>
        <View style={styles.choiceRow}>
          <Choice
            value="comfortable"
            current={preferences.density}
            label="舒展"
            onPress={(density) => update({ density })}
          />
          <Choice
            value="compact"
            current={preferences.density}
            label="紧凑"
            onPress={(density) => update({ density })}
          />
        </View>
        <View style={[styles.toggleRow, { borderColor: theme.line }]}>
          <View style={styles.toggleCopy}>
            <Text style={styles.controlLabel}>减少动态效果</Text>
            <Text style={styles.controlNote}>减弱异宠呼吸、跳动和页面过渡</Text>
          </View>
          <Switch
            value={preferences.reduceMotion}
            onValueChange={(reduceMotion) => update({ reduceMotion })}
            trackColor={{ false: theme.secondary, true: theme.accent }}
            thumbColor="#FFFFFF"
          />
        </View>
      </Surface>) : null}

      {pane === "notifications" ? (<Surface style={styles.section}><NotificationSettings state={notificationState}/>
        <View style={styles.sectionHead}>
          <View>
            <Text style={styles.sectionKicker}>通知</Text>
            <Text style={styles.sectionTitle}>只接收你关心的提醒</Text>
          </View>
        </View>
        {(
          [
            ["messages", "人类消息", "私聊与群聊的新消息"],
            ["mentions", "@ 与回复", "成员明确提到或回复你"],
            ["proposals", "提案与投票", "空间 Agent 发起的待确认事项"],
            ["reminders", "日程与提醒", "群提醒和个人提醒"],
            ["agentResults", "异宠与 Agent 结果", "整理、查询和生成任务完成"],
          ] as const
        ).map(([key, label, note]) => (
          <View
            key={key}
            style={[styles.toggleRow, { borderColor: theme.line }]}
          >
            <View style={styles.toggleCopy}>
              <Text style={styles.controlLabel}>{label}</Text>
              <Text style={styles.controlNote}>{note}</Text>
            </View>
            <Switch
              value={notificationPreferences[key]}
              onValueChange={(value) => updateNotifications({ [key]: value })}
              trackColor={{ false: theme.secondary, true: theme.accent }}
              thumbColor="#FFFFFF"
            />
          </View>
        ))}
        <View style={[styles.toggleRow, { borderColor: theme.line }]}>
          <View style={styles.toggleCopy}>
            <Text style={styles.controlLabel}>锁屏显示消息正文</Text>
            <Text style={styles.controlNote}>
              默认关闭；关闭时只显示是谁发来消息
            </Text>
          </View>
          <Switch
            value={notificationPreferences.showContentPreview}
            onValueChange={(showContentPreview) =>
              updateNotifications({ showContentPreview })
            }
            trackColor={{ false: theme.secondary, true: theme.accent }}
            thumbColor="#FFFFFF"
          />
        </View>
      </Surface>) : null}

      {pane === "reply" ? (<Surface style={styles.section}>
        <View style={styles.sectionHead}>
          <View>
            <Text style={styles.sectionKicker}>消息管家</Text>
            <Text style={styles.sectionTitle}>群聊回顾偏好</Text>
          </View>
        </View>
        <Text style={styles.controlNote}>
          只改变回答组织方式，不改变它能读取的范围，也不会让它编造群聊内容。
        </Text>
        <View style={styles.replyGrid}>
          {REPLY_STYLES.map((option) => (
            <Choice
              key={option.value}
              value={option.value}
              current={preferences.petReplyStyle}
              label={option.label}
              note={option.note}
              onPress={(petReplyStyle) => update({ petReplyStyle })}
            />
          ))}
        </View>
      </Surface>) : null}

      {(pane !== "notifications" && (dirty || notificationsDirty || pane === "appearance" || pane === "reply")) ? <>
      <View
        style={[
          styles.saveBar,
          {
            backgroundColor: theme.card,
            borderColor: theme.line,
            borderRadius: theme.radius + 4,
          },
        ]}
      >
        <View style={styles.saveCopy}>
          <Text style={styles.saveTitle}>
            {dirty || notificationsDirty ? "有尚未保存的调整" : "设置已同步"}
          </Text>
          {saveMessage ? (
            <Text style={[styles.saveNote, { color: theme.accent }]}>
              {saveMessage}
            </Text>
          ) : (
            <Text style={styles.saveNote}>本机即时预览，保存后随账号同步</Text>
          )}
        </View>
        <View style={styles.saveActions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              reset();
            }}
            style={[
              styles.smallButton,
              { borderColor: theme.line, borderRadius: theme.radius },
            ]}
          >
            <Text style={styles.smallButtonText}>恢复默认</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={
              saving || notificationsSaving || (!dirty && !notificationsDirty)
            }
            onPress={() => void persist()}
            style={[
              styles.smallButton,
              {
                backgroundColor: theme.primary,
                borderColor: theme.primary,
                borderRadius: theme.radius,
              },
              ((!dirty && !notificationsDirty) ||
                saving ||
                notificationsSaving) &&
                styles.disabled,
            ]}
          >
            <Text style={[styles.smallButtonText,{color:theme.onPrimary}]}>
              {saving || notificationsSaving ? "保存中" : "保存"}
            </Text>
          </Pressable>
        </View>

      </View></> : null}

      {pane === "account" ? (
        <Surface style={styles.section}>
          <Text style={styles.sectionTitle}>账号与数据</Text>
          <Text style={styles.controlNote}>
            导出你的资料与成长记录，或清理旧版浏览器数据。隐私说明和危险操作收在这里。
          </Text>
          <AppButton
            label={dataBusy ? "处理中…" : "导出我的数据"}
            variant="quiet"
            disabled={dataBusy}
            onPress={() => void exportData()}
          />
          <AppButton
            label={legacyCleared ? "旧数据已删除" : "删除旧原型数据"}
            variant="secondary"
            disabled={legacyCleared}
            onPress={() => void clearLegacy()}
          />
          <AppButton
            label="注销账号并删除数据"
            variant="danger"
            disabled={dataBusy}
            onPress={() => {
              setPassword("");
              setDeleting(true);
            }}
          />
          {dataMessage ? (
            <Text style={[styles.dataMessage, { color: theme.accent }]}>
              {dataMessage}
            </Text>
          ) : null}
        </Surface>
      ) : null}

      {profile?.isAdmin && pane === "account" ? (
        <View style={styles.adminRow}>
          <Pressable
            onPress={() => router.push("/admin/status")}
            style={[
              styles.admin,
              { backgroundColor: theme.secondary, borderRadius: theme.radius },
            ]}
          >
            <Text style={styles.adminText}>运行状态</Text>
            <Text style={{ color: theme.accent }}>↗</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/admin/invites")}
            style={[
              styles.admin,
              { backgroundColor: theme.secondary, borderRadius: theme.radius },
            ]}
          >
            <Text style={styles.adminText}>创建邀请码</Text>
            <Text style={{ color: theme.accent }}>↗</Text>
          </Pressable>
        </View>
      ) : null}
      <AppButton
        label="退出登录"
        variant="quiet"
        onPress={() => void signOut()}
      />
      <Text style={styles.version}>
        异宠 · 1.0.5
      </Text>

      <AvatarEditor visible={avatarOpen} onClose={()=>setAvatarOpen(false)}/>
      <ChatBackgroundEditor visible={backgroundOpen} onClose={()=>setBackgroundOpen(false)}/>
      <Modal
        transparent
        visible={deleting}
        animationType="fade"
        onRequestClose={() => setDeleting(false)}
      >
        <KeyboardScreen style={styles.overlay}>
          <Surface style={styles.deleteCard}>
            <Text style={styles.deleteTitle}>确认注销账号</Text>
            <Text style={styles.controlNote}>
              {isLocalDemo
                ? "本地体验数据会立即从当前浏览器删除，且无法恢复。"
                : "请输入当前密码再次验证。异宠私聊、草稿、画像和媒体会删除；关系空间中的本人消息会匿名化。"}
            </Text>
            {!isLocalDemo ? (
              <TextInput
                accessibilityLabel="当前密码"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                placeholder="当前密码"
                placeholderTextColor={theme.muted}
                style={[
                  styles.password,
                  {
                    backgroundColor: theme.secondary,
                    borderRadius: theme.radius,
                  },
                ]}
              />
            ) : null}
            <AppButton
              label="取消"
              variant="quiet"
              disabled={dataBusy}
              onPress={() => setDeleting(false)}
            />
            <AppButton
              label={dataBusy ? "正在删除…" : "永久注销并删除"}
              variant="danger"
              disabled={dataBusy || (!isLocalDemo && password.length < 8)}
              onPress={() => void deleteAccount()}
            />
          </Surface>
        </KeyboardScreen>
      </Modal>
    </KeyboardScrollView></KeyboardScreen>
  );
}

const useStyles = createThemedStyles((colors, theme) => ({
  page: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: 110,
    gap: spacing.md,
  },
  topline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 7,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    lineHeight: 39,
    fontWeight: "700",
  },
  lead: { color: colors.textMuted, maxWidth: 640, lineHeight: 22 },
  healthCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  healthCopy: { flex: 1, gap: 4 },
  healthTitle: { color: colors.text, fontWeight: "700", fontSize: 18 },
  healthButton: {
    borderWidth: 1,
    minHeight: 40,
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  healthButtonText: { fontSize: 12, fontWeight: "700" },
  avatar: {
    borderRadius: 12,
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.white, fontSize: 20, fontWeight: "700" },
  section: { gap: spacing.md },
  sectionHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  sectionKicker: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.2,
    marginBottom: 5,
  },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  sectionAside: { color: colors.textMuted, fontSize: 12 },
  presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  preset: {
    flexGrow: 1,
    flexBasis: 140,
    minHeight: 120,
    borderWidth: 1,
    padding: 14,
  },
  swatches: { flexDirection: "row", gap: 6, marginBottom: 16 },
  swatch: { width: 22, height: 8, borderRadius: 4 },
  presetName: { color: colors.text, fontSize: 16, fontWeight: "700" },
  presetNote: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 5,
  },
  preview: { borderWidth: 1, padding: 14 },
  previewCard: { padding: 15, gap: 16 },
  previewLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  previewTitle: { color: colors.text, fontWeight: "700", fontSize: 16 },
  previewCopy: { color: colors.textMuted, marginTop: 4, fontSize: 12 },
  previewDot: { width: 10, height: 10, borderRadius: 5 },
  previewButtons: { flexDirection: "row", gap: 8 },
  previewButton: {
    minHeight: 35,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  previewButtonText: { color: colors.white, fontWeight: "600", fontSize: 12 },
  disclosure: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 42,
  },
  disclosureText: { color: colors.text, fontWeight: "600" },
  disclosureIcon: { fontSize: 24, fontWeight: "700" },
  colorGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  colorControl: { flexGrow: 1, flexBasis: 225, gap: 9 },
  colorHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  colorChip: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.2)",
  },
  colorLabel: { color: colors.text, fontWeight: "600", fontSize: 13 },
  colorNote: { color: colors.textMuted, fontSize: 11 },
  hexInput: {
    minHeight: 42,
    borderWidth: 1,
    backgroundColor: theme.overlay,
    color: colors.text,
    paddingHorizontal: 12,
    fontFamily: Platform.OS === "web" ? "monospace" : undefined,
  },
  controlLabel: { color: colors.text, fontWeight: "600", fontSize: 14 },
  controlNote: { color: colors.textMuted, lineHeight: 20 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    flexGrow: 1,
    minWidth: 100,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  choiceLabel: { color: colors.text, fontWeight: "700", fontSize: 13 },
  choiceNote: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    paddingTop: spacing.md,
  },
  toggleCopy: { flex: 1, paddingRight: spacing.md, gap: 3 },
  replyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  saveBar: {
    borderWidth: 1,
    padding: 13,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  saveCopy: { flex: 1, minWidth: 190 },
  saveTitle: { color: colors.text, fontWeight: "700" },
  saveNote: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
  saveActions: { flexDirection: "row", gap: 8 },
  smallButton: {
    minHeight: 38,
    minWidth: 82,
    borderWidth: 1,
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  smallButtonText: { color: theme.text, fontWeight: "600", fontSize: 12 },
  disabled: { opacity: 0.42 },
  accountToggle: {
    borderWidth: 1,
    minHeight: 68,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  accountName: { color: colors.text, fontWeight: "700", fontSize: 16 },
  accountEmail: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  dataMessage: { textAlign: "center", fontSize: 12 },
  adminRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  admin: {
    flexGrow: 1,
    flexBasis: 200,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  adminText: { color: colors.text, fontWeight: "600" },
  version: { color: colors.textMuted, textAlign: "center", fontSize: 11 },
  overlay: {
    flex: 1,
    backgroundColor: theme.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  deleteCard: { width: "100%", maxWidth: 480, gap: spacing.md },
  deleteTitle: { color: colors.text, fontSize: 22, fontWeight: "700" },
  password: {
    minHeight: 50,
    color: colors.text,
    paddingHorizontal: spacing.md,
  },
}));
