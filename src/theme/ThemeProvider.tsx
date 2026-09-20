import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { Platform } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";
import { DEFAULT_THEME_PREFERENCES, normalizeThemePreferences, type ThemePreferences } from "./preferences";
import { ThemeContext, type ThemeContextValue } from "./ThemeContext";
import { themeFrom } from "./palette";
import { useSystemScheme } from "./useSystemScheme";
const STORAGE_PREFIX = "pet-cohabitation-theme-v1";

export function ThemeProvider({ children }: PropsWithChildren) {
  const { profile, isLocalDemo } = useSession();
  const systemScheme = useSystemScheme();
  const [preferences, setPreferences] = useState<ThemePreferences>(DEFAULT_THEME_PREFERENCES);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const storageKey = `${STORAGE_PREFIX}:${profile?.id ?? "guest"}`;
  const activeKey = useRef(storageKey); activeKey.current = storageKey;
  const editVersion = useRef(0);
  const ownerId = profile?.id;

  useEffect(() => {
    let active = true;
    setLoadedKey(null); setDirty(false); setSaving(false);
    const revision = ++editVersion.current;
    const load = async () => {
      let next = DEFAULT_THEME_PREFERENCES;
      try { const local = await AsyncStorage.getItem(storageKey); next = normalizeThemePreferences(local ? JSON.parse(local) : null); } catch { /* Use a readable default when saved data is damaged. */ }
      if (!active) return;
      setPreferences(next); setLoadedKey(storageKey);
      if (ownerId && !isLocalDemo) {
        const result = await requireSupabase().from("user_preferences").select("theme,pet_reply_style,reduce_motion").eq("user_id", ownerId).maybeSingle();
        if (active && revision === editVersion.current && !result.error && result.data) {
          setPreferences(normalizeThemePreferences({ ...(result.data.theme as Partial<ThemePreferences>), petReplyStyle: result.data.pet_reply_style, reduceMotion: result.data.reduce_motion }));
        }
      }
    };
    void load().catch(() => undefined);
    return () => { active = false; };
  }, [isLocalDemo, ownerId, storageKey]);

  const visiblePreferences = loadedKey === storageKey ? preferences : DEFAULT_THEME_PREFERENCES;
  const theme = useMemo(() => themeFrom(visiblePreferences, systemScheme === "dark"), [visiblePreferences, systemScheme]);
  useEffect(() => {
    if (loadedKey === storageKey) void AsyncStorage.setItem(storageKey, JSON.stringify(preferences)).catch(() => undefined);
  }, [preferences, loadedKey, storageKey]);
  useEffect(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.documentElement.style.backgroundColor = theme.page;
      document.body.style.backgroundColor = theme.page;
      document.documentElement.style.colorScheme = theme.isDark ? "dark" : "light";
      document.documentElement.style.setProperty("--app-page", theme.page);
      document.documentElement.style.setProperty("--app-card", theme.card);
      document.documentElement.style.setProperty("--app-primary", theme.primary);
      document.documentElement.style.setProperty("--app-accent", theme.accent);
    }
  }, [theme]);
  const update = useCallback((patch: Partial<ThemePreferences>) => {
    if (loadedKey !== storageKey) return;
    editVersion.current++;
    setPreferences(current => normalizeThemePreferences({ ...current, ...patch })); setDirty(true);
  }, [loadedKey, storageKey]);
  const replace = useCallback((value: ThemePreferences) => { update(value); }, [update]);
  const reset = useCallback(() => { update(DEFAULT_THEME_PREFERENCES); }, [update]);
  const save = useCallback(async () => {
    if (loadedKey !== storageKey) throw new Error("设置还在加载，请稍后再试。");
    const revision = editVersion.current;
    setSaving(true);
    try {
      await AsyncStorage.setItem(storageKey, JSON.stringify(preferences));
      if (ownerId && !isLocalDemo) {
        const { error } = await requireSupabase().from("user_preferences").upsert({ user_id: ownerId, theme: preferences, pet_reply_style: preferences.petReplyStyle, reduce_motion: preferences.reduceMotion, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
        if (error) throw error;
      }
      if (activeKey.current === storageKey && revision === editVersion.current) setDirty(false);
    } finally { if (activeKey.current === storageKey) setSaving(false); }
  }, [isLocalDemo, preferences, ownerId, storageKey, loadedKey]);
  const value = useMemo<ThemeContextValue>(() => ({ preferences: visiblePreferences, theme, ready: loadedKey === storageKey, dirty: loadedKey === storageKey && dirty, saving, update, replace, save, reset }), [dirty, visiblePreferences, loadedKey, storageKey, replace, reset, save, saving, theme, update]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useAppTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useAppTheme must be used inside ThemeProvider");
  return value;
}
