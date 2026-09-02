import { useCallback, useEffect, useState } from "react";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";

export type NotificationEvent = Readonly<{
  id: string;
  kind: "message" | "mention" | "proposal" | "reminder" | "agent_result";
  title: string;
  body: string;
  route: string;
  readAt: string | null;
  createdAt: string;
}>;

type NotificationRow = Readonly<{
  id: string;
  kind: NotificationEvent["kind"];
  title: string;
  body: string;
  route: string;
  read_at: string | null;
  created_at: string;
}>;

function mapRow(row: NotificationRow): NotificationEvent {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    route: row.route,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export function useNotificationInbox(limit = 50) {
  const { profile, isLocalDemo } = useSession();
  const [events, setEvents] = useState<readonly NotificationEvent[]>([]);
  const [loading, setLoading] = useState(!isLocalDemo);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!profile || isLocalDemo) {
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: queryError } = await requireSupabase()
      .from("notification_events")
      .select("id,kind,title,body,route,read_at,created_at")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (queryError) {
      setError(queryError.message);
    } else {
      setEvents(((data ?? []) as NotificationRow[]).map(mapRow));
      setError(null);
    }
    setLoading(false);
  }, [isLocalDemo, limit, profile]);

  useEffect(() => {
    void reload();
    if (!profile || isLocalDemo) return;
    const channel = requireSupabase()
      .channel(`notification-inbox:${profile.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notification_events", filter: `user_id=eq.${profile.id}` },
        () => void reload(),
      )
      .subscribe();
    return () => {
      void requireSupabase().removeChannel(channel);
    };
  }, [isLocalDemo, profile, reload]);

  const markRead = useCallback(async (eventId: string) => {
    if (isLocalDemo) return;
    setEvents((current) => current.map((event) => event.id === eventId ? { ...event, readAt: event.readAt ?? new Date().toISOString() } : event));
    const { error: rpcError } = await requireSupabase().rpc("mark_notification_read", { target_event_id: eventId });
    if (rpcError) {
      await reload();
      throw rpcError;
    }
  }, [isLocalDemo, reload]);

  return {
    events,
    unreadCount: events.filter((event) => !event.readAt).length,
    loading,
    error,
    reload,
    markRead,
  } as const;
}
