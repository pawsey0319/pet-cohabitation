import { useCallback, useEffect, useState } from "react";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";

export type AIProviderHealth = Readonly<{
  textOnline: boolean;
  imageOnline: boolean;
  statusCode: "unknown" | "mock" | "online" | "partial" | "offline";
  checkedAt: string | null;
}>;

const UNKNOWN: AIProviderHealth = { textOnline: false, imageOnline: false, statusCode: "unknown", checkedAt: null };

export function useAIProviderHealth() {
  const { profile, isLocalDemo } = useSession();
  const [health, setHealth] = useState<AIProviderHealth>(UNKNOWN);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    if (!profile || isLocalDemo) {
      setHealth({ textOnline: true, imageOnline: true, statusCode: "mock", checkedAt: new Date().toISOString() });
      return;
    }
    setChecking(true);
    try {
      const client = requireSupabase();
      await client.functions.invoke("model-health", { body: {} });
      const { data, error } = await client.from("ai_provider_health").select("text_online,image_online,status_code,checked_at").eq("id", true).maybeSingle();
      if (error) throw error;
      if (data) setHealth({ textOnline: data.text_online, imageOnline: data.image_online, statusCode: data.status_code, checkedAt: data.checked_at });
    } catch {
      setHealth({ textOnline: false, imageOnline: false, statusCode: "offline", checkedAt: new Date().toISOString() });
    } finally {
      setChecking(false);
    }
  }, [isLocalDemo, profile]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { health, checking, refresh } as const;
}
