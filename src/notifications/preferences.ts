import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";

export type NotificationPreferences = Readonly<{
  messages: boolean;
  mentions: boolean;
  proposals: boolean;
  reminders: boolean;
  agentResults: boolean;
  showContentPreview: boolean;
  quietStart: string;
  quietEnd: string;
  timezone: string;
}>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  messages: true,
  mentions: true,
  proposals: true,
  reminders: true,
  agentResults: true,
  showContentPreview: false,
  quietStart: "23:00",
  quietEnd: "08:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
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
    quietStart: /^([01]\d|2[0-3]):[0-5]\d/.test(value?.quietStart ?? "") ? value!.quietStart!.slice(0, 5) : "23:00",
    quietEnd: /^([01]\d|2[0-3]):[0-5]\d/.test(value?.quietEnd ?? "") ? value!.quietEnd!.slice(0, 5) : "08:00",
    timezone: value?.timezone || DEFAULT_NOTIFICATION_PREFERENCES.timezone,
  };
}

export function useNotificationPreferences() {
  const { profile, isLocalDemo } = useSession();
  const [preferences, setPreferences] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const owner = useRef(profile?.id); owner.current = profile?.id;
  const edited = useRef(0), pendingPatch = useRef<Partial<NotificationPreferences>>({});

  useEffect(() => {
    setPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
    setLoadedOwner(profile?.id ?? null); pendingPatch.current = {}; edited.current++;
    setDirty(false);
    setSaving(false);
    if (!profile) return;
    let active = true;
    const load = async () => {
      const raw = await AsyncStorage.getItem(keyFor(profile.id));
      let next = DEFAULT_NOTIFICATION_PREFERENCES;
      try { next = normalize(raw ? JSON.parse(raw) as Partial<NotificationPreferences> : null); } catch { /* A corrupt local cache must not prevent reading cloud preferences. */ }
      if (!isLocalDemo) {
        const { data, error } = await requireSupabase().from("notification_preferences").select("*").eq("user_id", profile.id).maybeSingle();
        if (!error && data) next = normalize({ messages: data.messages_enabled, mentions: data.mentions_enabled, proposals: data.proposals_enabled, reminders: data.reminders_enabled, agentResults: data.agent_results_enabled, showContentPreview: data.show_content_preview, quietStart: data.quiet_start, quietEnd: data.quiet_end, timezone: data.timezone });
      }
      if (active) setPreferences(normalize({ ...next, ...pendingPatch.current }));
    };
    void load().catch(() => undefined);
    return () => { active = false; };
  }, [isLocalDemo, profile?.id]);

  const update = useCallback((patch: Partial<NotificationPreferences>) => {
    edited.current++; pendingPatch.current = { ...pendingPatch.current, ...patch };
    setPreferences((current) => normalize({ ...current, ...patch }));
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!profile) return;
    const ownerId = profile.id, revision = edited.current, changes = { ...pendingPatch.current };
    setSaving(true);
    try {
      let saved = preferences;
      if (!isLocalDemo) {
        // Rebase only the fields the user actually edited. A delayed/failed initial
        // load cannot reset another device's explicit notification preferences.
        const current = await requireSupabase().from("notification_preferences").select("*").eq("user_id", ownerId).maybeSingle();
        if (current.error) throw current.error;
        const row = current.data;
        const baseline = row ? normalize({ messages: row.messages_enabled, mentions: row.mentions_enabled, proposals: row.proposals_enabled, reminders: row.reminders_enabled, agentResults: row.agent_results_enabled, showContentPreview: row.show_content_preview, quietStart: row.quiet_start, quietEnd: row.quiet_end, timezone: row.timezone }) : DEFAULT_NOTIFICATION_PREFERENCES;
        saved = normalize({ ...baseline, ...changes });
        if (owner.current !== ownerId) throw new Error("通知设置的账号已经切换。");
        const { error } = await requireSupabase().from("notification_preferences").upsert({
          user_id: ownerId,
          messages_enabled: saved.messages,
          mentions_enabled: saved.mentions,
          proposals_enabled: saved.proposals,
          reminders_enabled: saved.reminders,
          agent_results_enabled: saved.agentResults,
          show_content_preview: saved.showContentPreview,
          quiet_start: saved.quietStart,
          quiet_end: saved.quietEnd,
          timezone: saved.timezone,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        if (error) throw error;
      }
      if (owner.current !== ownerId) throw new Error("通知设置的账号已经切换。");
      await AsyncStorage.setItem(keyFor(ownerId), JSON.stringify(saved));
      if (owner.current === ownerId && edited.current === revision) { pendingPatch.current = {}; setPreferences(saved); setDirty(false); }
    } finally {
      if (owner.current === ownerId) setSaving(false);
    }
  }, [isLocalDemo, preferences, profile]);

  const reset = useCallback(() => { edited.current++; pendingPatch.current = { ...DEFAULT_NOTIFICATION_PREFERENCES }; setPreferences(DEFAULT_NOTIFICATION_PREFERENCES); setDirty(true); }, []);

  return { preferences: loadedOwner === profile?.id ? preferences : DEFAULT_NOTIFICATION_PREFERENCES, dirty: loadedOwner === profile?.id && dirty, saving: loadedOwner === profile?.id && saving, update, save, reset } as const;
}
