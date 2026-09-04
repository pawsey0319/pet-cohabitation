import { useCallback, useEffect, useState } from "react";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";
import { createRequestId } from "../lib/uuid";

export type NotificationEvent = Readonly<{
  id: string;
  kind: "message" | "mention" | "proposal" | "reminder" | "agent_result";
  title: string;
  body: string;
  route: string;
  spaceId: string | null;
  messageId: string | null;
  readAt: string | null;
  createdAt: string;
}>;

type NotificationRow = Readonly<{
  id: string;
  kind: NotificationEvent["kind"];
  title: string;
  body: string;
  route: string;
  payload: { space_id?: string; message_id?: string } | null;
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
    spaceId: row.payload?.space_id ?? null,
    messageId: row.payload?.message_id ?? null,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export function useNotificationInbox(limit = 50) {
  const { profile, isLocalDemo } = useSession();
  const userId = profile?.id;
  const [events, setEvents] = useState<readonly NotificationEvent[]>([]);
  const [loading, setLoading] = useState(!isLocalDemo);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!userId || isLocalDemo) {
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error: queryError } = await requireSupabase()
        .from("notification_events")
        .select("id,kind,title,body,route,payload,read_at,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (queryError) {
        setError(queryError.message);
      } else {
        setEvents(((data ?? []) as NotificationRow[]).map(mapRow));
        setError(null);
      }
    } catch {
      setError("通知暂时加载失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [isLocalDemo, limit, userId]);

  useEffect(() => {
    void reload();
    if (!userId || isLocalDemo) return;
    const client = requireSupabase();
    // The chats tab stays mounted beneath the inbox screen. Each consumer must
    // own its channel: Supabase reuses a channel with the same name, and adding
    // callbacks after the first subscription crashes older SDK builds.
    const channel = client.channel(`notification-inbox:${userId}:${createRequestId()}`);
    try {
      channel
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notification_events", filter: `user_id=eq.${userId}` },
          () => void reload(),
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setError("实时通知连接中断，可点击重试刷新。");
        });
    } catch {
      setError("实时通知暂不可用，可点击重试刷新。");
    }
    return () => {
      void client.removeChannel(channel).catch(() => undefined);
    };
  }, [isLocalDemo, userId, reload]);

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
