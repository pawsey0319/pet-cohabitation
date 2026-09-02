import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";

export type NotificationPreferences = Readonly<{
  messages: boolean;
  mentions: boolean;
  proposals: boolean;
  reminders: boolean;
  agentResults: boolean;
  showContentPreview: boolean;
}>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  messages: true,
  mentions: true,
  proposals: true,
  reminders: true,
  agentResults: true,
  showContentPreview: false,
};

const keyFor = (userId: string) => `pet-cohabitation-notifications-v1:${userId}`;

function normalize(value: Partial<NotificationPreferences> | null | undefined): NotificationPreferences {
  return {
    messages: value?.messages !== false,
    mentions: value?.mentions !== false,
    proposals: value?.proposals !== false,
    reminders: value?.reminders !== false,
    agentResults: value?.agentResults !== false,
    showContentPreview: value?.showContentPreview === true,
  };
}

export function useNotificationPreferences() {
  const { profile, isLocalDemo } = useSession();
  const [preferences, setPreferences] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    const load = async () => {
      const raw = await AsyncStorage.getItem(keyFor(profile.id));
      let next = normalize(raw ? JSON.parse(raw) as Partial<NotificationPreferences> : null);
      if (!isLocalDemo) {
        const { data, error } = await requireSupabase().from("notification_preferences").select("messages_enabled,mentions_enabled,proposals_enabled,reminders_enabled,agent_results_enabled,show_content_preview").eq("user_id", profile.id).maybeSingle();
        if (!error && data) next = normalize({ messages: data.messages_enabled, mentions: data.mentions_enabled, proposals: data.proposals_enabled, reminders: data.reminders_enabled, agentResults: data.agent_results_enabled, showContentPreview: data.show_content_preview });
      }
      if (active) { setPreferences(next); setDirty(false); }
    };
    void load().catch(() => undefined);
    return () => { active = false; };
  }, [isLocalDemo, profile]);

  const update = useCallback((patch: Partial<NotificationPreferences>) => {
    setPreferences((current) => normalize({ ...current, ...patch }));
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!profile) return;
    setSaving(true);
    try {
      await AsyncStorage.setItem(keyFor(profile.id), JSON.stringify(preferences));
      if (!isLocalDemo) {
        const { error } = await requireSupabase().from("notification_preferences").upsert({
          user_id: profile.id,
          messages_enabled: preferences.messages,
          mentions_enabled: preferences.mentions,
          proposals_enabled: preferences.proposals,
          reminders_enabled: preferences.reminders,
          agent_results_enabled: preferences.agentResults,
          show_content_preview: preferences.showContentPreview,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        if (error) throw error;
      }
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [isLocalDemo, preferences, profile]);

  const reset = useCallback(() => { setPreferences(DEFAULT_NOTIFICATION_PREFERENCES); setDirty(true); }, []);

  return { preferences, dirty, saving, update, save, reset } as const;
}
