import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";
import { createRequestId } from "../lib/uuid";
import { AvatarImage, GroupAvatar } from "./AvatarImage";
import { getAvatarState } from "./repository";
import type { AvatarMember } from "./types";

// This component fetches independently from the message list. It stores no disk
// cache or signed URLs and fences every refresh to the mounted account + group.
export function SpaceAvatar({ spaceId, name, size = 48 }: { spaceId: string; name: string; size?: number }) {
  const { profile, isLocalDemo } = useSession(); const key = `${profile?.id}:${spaceId}`;
  const [stored, setStored] = useState<{ key: string; reference: string | null; members: AvatarMember[] } | null>(null);
  const current = useRef(key); current.current = key;
  useEffect(() => {
    if (!profile || isLocalDemo || !spaceId) return;
    const client = requireSupabase(); let live = true; let refreshing = false; let again = false; let epoch = 0; let memberIds = new Set<string>();
    const clear = () => { epoch++; if (live && current.current === key) setStored(null); };
    const refresh = async () => {
      if (!live) return; if (refreshing) { again = true; return; } refreshing = true;
      const started = epoch;
      try {
        const [state, result] = await Promise.all([
          getAvatarState(profile.id, { kind: "space", id: spaceId }),
          client.from("space_members").select("user_id,joined_at,profiles!space_members_user_id_fkey(nickname,avatar_url)").eq("space_id", spaceId).order("joined_at").order("user_id"),
        ]);
        if (result.error) throw result.error;
        if (!result.data?.some(row => row.user_id === profile.id)) throw new Error("membership_revoked");
        const members = result.data.map(row => {
          const entry = (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as { nickname?: string; avatar_url?: string | null } | null;
          return { id: row.user_id, joinedAt: row.joined_at, nickname: entry?.nickname ?? "成员", avatarUrl: entry?.avatar_url ?? null };
        });
        if (live && current.current === key && started === epoch) { memberIds = new Set(members.map(member => member.id)); setStored({ key, reference: state.reference, members }); }
      } catch { clear(); }
      finally { refreshing = false; if (again && live) { again = false; void refresh(); } }
    };
    void refresh();
    const channel = client.channel(`space-avatar:${profile.id}:${spaceId}:${createRequestId()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "space_members", filter: `space_id=eq.${spaceId}` }, event => {
        if (event.eventType === "DELETE" && (event.old as { user_id?: string }).user_id === profile.id) { clear(); return; }
        // Revalidate membership before rendering member additions/removals.
        clear(); void refresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "avatar_bindings", filter: `target_id=eq.${spaceId}` }, () => void refresh())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, event => { if (memberIds.has(String(event.new.id))) void refresh(); })
      .subscribe(status => { if (status === "SUBSCRIBED") void refresh(); if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") clear(); });
    const foreground = AppState.addEventListener("change", status => { if (status === "active") void refresh(); });
    return () => { live = false; foreground.remove(); void client.removeChannel(channel); };
  }, [key, profile?.id, spaceId, isLocalDemo]);
  const data = stored?.key === key ? stored : null;
  return data ? <GroupAvatar reference={data.reference} members={data.members} name={name} size={size} /> : <AvatarImage name={name} size={size} />;
}
