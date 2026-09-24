import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";
import { createRequestId } from "../lib/uuid";
import { AvatarImage, GroupAvatar } from "./AvatarImage";
import { cachedSpaceAvatar, clearAvatarLocalData, getSpaceAvatarState, hydrateSpaceAvatar, subscribeAvatarCache } from "./repository";

export function SpaceAvatar({ spaceId, name, size = 48 }: { spaceId: string; name: string; size?: number }) {
  const { profile, isLocalDemo } = useSession(); const key = `${profile?.id}:${spaceId}`;
  const [, redraw] = useState(0);
  const current = useRef(key); current.current = key;
  useEffect(() => {
    if (!profile || isLocalDemo || !spaceId) return;
    const owner = profile.id, client = requireSupabase(); let live = true; let refreshing = false; let again = false; let subscribed = false;
    const unsubscribe = subscribeAvatarCache(() => { if (live && current.current === key) redraw(value => value + 1); });
    void hydrateSpaceAvatar(owner, spaceId).catch(() => undefined);
    const refresh = async () => {
      if (!live) return; if (refreshing) { again = true; return; } refreshing = true;
      try { await getSpaceAvatarState(owner, spaceId); }
      catch { /* Network failure preserves cache; repository clears confirmed revocations. */ }
      finally { refreshing = false; if (again && live) { again = false; void refresh(); } }
    };
    void refresh();
    const channel = client.channel(`space-avatar:${profile.id}:${spaceId}:${createRequestId()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "space_members", filter: `space_id=eq.${spaceId}` }, event => {
        if (event.eventType === "DELETE") {
          void clearAvatarLocalData(owner, spaceId);
          if ((event.old as { user_id?: string }).user_id === owner) return;
        }
        void refresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "avatar_bindings", filter: `target_id=eq.${spaceId}` }, () => void refresh())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, event => {
        if (cachedSpaceAvatar(owner, spaceId)?.members.some(member => member.id === String(event.new.id))) void refresh();
      })
      .subscribe(status => { if (status === "SUBSCRIBED") { if (subscribed) void refresh(); subscribed = true; } });
    const foreground = AppState.addEventListener("change", status => { if (status === "active") void refresh(); });
    return () => { live = false; unsubscribe(); foreground.remove(); void client.removeChannel(channel); };
  }, [key, profile?.id, spaceId, isLocalDemo]);
  const data = profile && !isLocalDemo ? cachedSpaceAvatar(profile.id, spaceId) : null;
  return data ? <GroupAvatar reference={data.reference} members={data.members} name={name} size={size} spaceId={spaceId} /> : <AvatarImage name={name} size={size} />;
}
