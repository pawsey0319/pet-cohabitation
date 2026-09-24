import { useEffect, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { cachedAvatarUri, discardAvatarImage, resolveAvatarUrl, subscribeAvatarCache } from "./repository";
import { petAvatarReference, stableAvatarMembers, type ActorAvatarRef, type AvatarMember } from "./types";

export function AvatarImage({ reference, name, size = 44, spaceId }: { reference?: string | null; name: string; size?: number; spaceId?: string }) {
  const { profile } = useSession(); const { theme } = useAppTheme();
  const key = `${profile?.id ?? ""}:${spaceId ?? ""}:${reference ?? ""}`;
  const [, redraw] = useState(0); const [failed, setFailed] = useState<string | null>(null);
  const retried = useRef<string | null>(null);
  useEffect(() => {
    const unsubscribe = subscribeAvatarCache(() => redraw(value => value + 1));
    if (profile && reference) void resolveAvatarUrl(profile.id, reference, { spaceId }).catch(() => undefined);
    return unsubscribe;
  }, [key, profile?.id, reference, spaceId]);
  const uri = reference && /^https?:\/\//.test(reference) ? reference : profile && reference ? cachedAvatarUri(profile.id, reference, spaceId) : null;
  const failureKey = `${key}:${uri}`;
  const onError = () => {
    setFailed(failureKey);
    if (!profile || !reference || /^https?:\/\//.test(reference) || retried.current === key) return;
    retried.current = key;
    void discardAvatarImage(profile.id, reference, spaceId)
      .then(() => resolveAvatarUrl(profile.id, reference, { spaceId, force: true }))
      .then(value => { if (value) setFailed(null); }).catch(() => undefined);
  };
  return <View accessibilityLabel={`${name}的头像`} style={{ width: size, height: size, borderRadius: Math.min(12, size / 4), overflow: "hidden", backgroundColor: theme.userBubble, alignItems: "center", justifyContent: "center" }}>
    {uri && failed !== failureKey ? <Image source={{ uri }} resizeMode={reference?.startsWith("pet-avatar://") ? "contain" : "cover"} style={{ width: size, height: size }} onError={onError} /> : <Text style={{ color: theme.userText, fontSize: Math.max(10, size * .38), fontWeight: "600" }}>{Array.from(name.trim())[0] || "·"}</Text>}
  </View>;
}
export function ActorAvatarImage({ actor, name, size = 44 }: { actor: ActorAvatarRef; name: string; size?: number }) {
  return <AvatarImage reference={actor.kind === "pet" ? petAvatarReference(actor.actorId) : actor.reference} name={name} size={size} spaceId={actor.spaceId} />;
}
export function GroupAvatar({ reference, members, name, size = 48, spaceId }: { reference?: string | null; members: readonly AvatarMember[]; name: string; size?: number; spaceId?: string }) {
  const { theme } = useAppTheme(); const ordered = stableAvatarMembers(members);
  if (reference || !ordered.length) return <AvatarImage reference={reference} name={name} size={size} spaceId={spaceId} />;
  const columns = ordered.length <= 4 ? 2 : 3; const gap = 2;
  const tile = (size - gap * (columns + 1)) / columns;
  return <View accessibilityLabel={`${name}的成员头像拼图`} style={{ width: size, height: size, flexDirection: "row", flexWrap: "wrap", alignContent: "center", justifyContent: "center", gap, padding: gap, borderRadius: 12, overflow: "hidden", backgroundColor: theme.cardSoft }}>
    {ordered.map(member => <AvatarImage key={member.id} reference={member.avatarUrl} name={member.nickname} size={tile} spaceId={spaceId} />)}
  </View>;
}
