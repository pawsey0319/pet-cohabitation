import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";

export type AIProviderHealth = Readonly<{
  textOnline: boolean;
  imageOnline: boolean;
  statusCode: "unknown" | "mock" | "online" | "partial" | "offline";
  checkedAt: string | null;
  textCheck?: "generation" | "catalog" | "failed" | "mock";
  imageCheck?: "catalog" | "failed" | "mock";
}>;

const UNKNOWN: AIProviderHealth = { textOnline: false, imageOnline: false, statusCode: "unknown", checkedAt: null };

export function useAIProviderHealth() {
  const { profile, isLocalDemo } = useSession();
  const [health, setHealth] = useState<AIProviderHealth>(UNKNOWN);
  const [checking, setChecking] = useState(false);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!profile) { setHealth(UNKNOWN); setChecking(false); return; }
    if (isLocalDemo) {
      setHealth({ textOnline: true, imageOnline: true, statusCode: "mock", checkedAt: new Date().toISOString() });
      return;
    }
    setChecking(true);
    try {
      const client = requireSupabase();
      const { data, error } = await client.functions.invoke("model-health", { body: {} });
      if (error) throw error;
      if (!data || typeof data.text_online !== "boolean" || typeof data.image_online !== "boolean") throw new Error("health_response_invalid");
      if (version === requestVersion.current) setHealth({ textOnline: data.text_online, imageOnline: data.image_online, statusCode: data.status_code, checkedAt: data.checked_at, textCheck: data.text_check ?? "catalog", imageCheck: data.image_check ?? "catalog" });
    } catch {
      if (version === requestVersion.current) setHealth(UNKNOWN);
    } finally {
      if (version === requestVersion.current) setChecking(false);
    }
  }, [isLocalDemo, profile]);

  useEffect(() => { void refresh(); return () => { requestVersion.current += 1; }; }, [refresh]);
  return { health, checking, refresh } as const;
}
