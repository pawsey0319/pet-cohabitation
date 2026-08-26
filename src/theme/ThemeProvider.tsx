import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { Platform } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";
import { DEFAULT_THEME_PREFERENCES, normalizeThemePreferences, type ThemePreferences } from "./preferences";
import { ThemeContext, type AppTheme, type ThemeContextValue } from "./ThemeContext";

const STORAGE_PREFIX = "pet-cohabitation-theme-v1";

function themeFrom(preferences: ThemePreferences): AppTheme {
  return {
    page: preferences.pageBackground,
    card: preferences.cardBackground,
    cardSoft: preferences.secondaryButton,
    primary: preferences.primaryButton,
    secondary: preferences.secondaryButton,
    danger: preferences.dangerButton,
    accent: preferences.accent,
    text: "#F8F6FF",
    muted: "#B9B5CC",
    line: "rgba(236,232,255,.14)",
    radius: preferences.cornerStyle === "compact" ? 10 : preferences.cornerStyle === "round" ? 28 : 18,
    controlHeight: preferences.density === "compact" ? 42 : 48,
  };
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const { profile, isLocalDemo } = useSession();
  const [preferences, setPreferences] = useState<ThemePreferences>(DEFAULT_THEME_PREFERENCES);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const storageKey = `${STORAGE_PREFIX}:${profile?.id ?? "guest"}`;

  useEffect(() => {
    let active = true;
    const load = async () => {
      const local = await AsyncStorage.getItem(storageKey);
      let next = normalizeThemePreferences(local ? JSON.parse(local) as Partial<ThemePreferences> : null);
      if (profile && !isLocalDemo) {
        const result = await requireSupabase().from("user_preferences").select("theme,pet_reply_style,reduce_motion").eq("user_id", profile.id).maybeSingle();
        if (!result.error && result.data) next = normalizeThemePreferences({ ...(result.data.theme as Partial<ThemePreferences>), petReplyStyle: result.data.pet_reply_style, reduceMotion: result.data.reduce_motion });
      }
      if (active) { setPreferences(next); setDirty(false); }
    };
    void load().catch(() => undefined);
    return () => { active = false; };
  }, [isLocalDemo, profile, storageKey]);

  useEffect(() => {
    void AsyncStorage.setItem(storageKey, JSON.stringify(preferences));
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.documentElement.style.backgroundColor = preferences.pageBackground;
      document.body.style.backgroundColor = preferences.pageBackground;
      document.documentElement.style.setProperty("--app-page", preferences.pageBackground);
      document.documentElement.style.setProperty("--app-card", preferences.cardBackground);
      document.documentElement.style.setProperty("--app-primary", preferences.primaryButton);
      document.documentElement.style.setProperty("--app-accent", preferences.accent);
    }
  }, [preferences, storageKey]);

  const update = useCallback((patch: Partial<ThemePreferences>) => { setPreferences((current) => normalizeThemePreferences({ ...current, ...patch })); setDirty(true); }, []);
  const replace = useCallback((value: ThemePreferences) => { setPreferences(normalizeThemePreferences(value)); setDirty(true); }, []);
  const reset = useCallback(() => { setPreferences(DEFAULT_THEME_PREFERENCES); setDirty(true); }, []);
  const save = useCallback(async () => {
    setSaving(true);
    try {
      await AsyncStorage.setItem(storageKey, JSON.stringify(preferences));
      if (profile && !isLocalDemo) {
        const { error } = await requireSupabase().from("user_preferences").upsert({ user_id: profile.id, theme: preferences, pet_reply_style: preferences.petReplyStyle, reduce_motion: preferences.reduceMotion, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
        if (error) throw error;
      }
      setDirty(false);
    } finally { setSaving(false); }
  }, [isLocalDemo, preferences, profile, storageKey]);

  const theme = useMemo(() => themeFrom(preferences), [preferences]);
  const value = useMemo<ThemeContextValue>(() => ({ preferences, theme, dirty, saving, update, replace, save, reset }), [dirty, preferences, replace, reset, save, saving, theme, update]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useAppTheme must be used inside ThemeProvider");
  return value;
}
