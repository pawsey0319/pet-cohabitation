import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { resolveAvatarUrl } from "./repository";
import { stableAvatarMembers, type AvatarMember } from "./types";

export function AvatarImage({ reference, name, size = 44 }: { reference?: string | null; name: string; size?: number }) {
  const { profile } = useSession(); const { theme } = useAppTheme();
  const key = `${profile?.id ?? ""}:${reference ?? ""}`;
  const [loaded, setLoaded] = useState<{ key: string; uri: string } | null>(null);
  useEffect(() => {
    let active = true;
    if (profile && reference) void resolveAvatarUrl(profile.id, reference).then(uri => {
      if (active) setLoaded(uri ? { key, uri } : null);
    }).catch(() => { if (active) setLoaded(null); });
    return () => { active = false; };
  }, [key, profile?.id, reference]);
  const uri = loaded?.key === key ? loaded.uri : null;
  return <View accessibilityLabel={`${name}的头像`} style={{ width: size, height: size, borderRadius: Math.min(12, size / 4), overflow: "hidden", backgroundColor: theme.userBubble, alignItems: "center", justifyContent: "center" }}>
    {uri ? <Image source={{ uri }} resizeMode="cover" style={{ width: size, height: size }} onError={() => setLoaded(null)} /> : <Text style={{ color: theme.userText, fontSize: Math.max(10, size * .38), fontWeight: "600" }}>{Array.from(name.trim())[0] || "·"}</Text>}
  </View>;
}
export function GroupAvatar({ reference, members, name, size = 48 }: { reference?: string | null; members: readonly AvatarMember[]; name: string; size?: number }) {
  const { theme } = useAppTheme(); const ordered = stableAvatarMembers(members);
  if (reference || !ordered.length) return <AvatarImage reference={reference} name={name} size={size} />;
  const columns = ordered.length <= 4 ? 2 : 3; const gap = 2;
  const tile = (size - gap * (columns + 1)) / columns;
  return <View accessibilityLabel={`${name}的成员头像拼图`} style={{ width: size, height: size, flexDirection: "row", flexWrap: "wrap", alignContent: "center", justifyContent: "center", gap, padding: gap, borderRadius: 12, overflow: "hidden", backgroundColor: theme.cardSoft }}>
    {ordered.map(member => <AvatarImage key={member.id} reference={member.avatarUrl} name={member.nickname} size={tile} />)}
  </View>;
}
