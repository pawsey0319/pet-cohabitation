import { usePetWorkspace } from "../pets/PetWorkspaceProvider";
import { usePetSectionFocusEffect } from "../pets/PetSectionScope";
import { useEffect } from "react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Redirect, useFocusEffect, useRouter, type Href } from "expo-router";
import { useSession } from "../auth/SessionProvider";
import { createPetRepository } from "../data/petRepository";
import type { PetDashboard } from "../data/types";
import { AppButton } from "../ui/common";
import { useAppTheme } from "../theme/ThemeProvider";

export function useOwnedPet() {
  const { profile, isLocalDemo } = useSession();
  const workspace = usePetWorkspace();
  const repository = workspace?.repository ?? null;
  const owner = profile?.id; const current = useRef(owner); current.current = owner;
  const [loaded, setLoaded] = useState<{ owner: string; dashboard: PetDashboard } | null>(() => { const dashboard = workspace?.cache.peek<PetDashboard>("getDashboard:[]"); return dashboard && owner ? { owner, dashboard } : null; });
  const [error, setError] = useState<string | null>(null); const sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (!owner || !repository) return;
    const request = ++sequence.current;
    try { const dashboard = await repository.getDashboard(); if (current.current === owner && sequence.current === request) { setLoaded({ owner, dashboard }); setError(null); } }
    catch { if (current.current === owner && sequence.current === request) setError("暂时没有取得异宠资料，请检查网络后重试。"); }
  }, [owner, repository]);
  usePetSectionFocusEffect(useCallback(() => { void refresh(); return () => { sequence.current++; }; }, [refresh]));
  usePetSectionFocusEffect(useCallback(() => repository?.subscribe(() => { void refresh(); }), [repository, refresh]));
  return { profile, isLocalDemo, repository, dashboard: loaded && loaded.owner === owner ? loaded.dashboard : null, error, refresh };
}
export function OwnedPetGate({ state, children }: { state: ReturnType<typeof useOwnedPet>; children: ReactNode }) {
  const { theme } = useAppTheme(); const router = useRouter();
  if (!state.profile) return <Redirect href="/login" />;
  if (!state.dashboard) return <View style={{ gap: 12 }}>{state.error ? <><Text style={{ color: theme.text }}>{state.error}</Text><AppButton label="重新加载" onPress={() => void state.refresh()} /></> : <ActivityIndicator color={theme.accent} />}</View>;
  if (state.dashboard.pet?.status !== "confirmed") return <View style={{ gap: 12 }}><Text style={{ color: theme.text }}>先回到异宠页，完成期待、生成和确认，就可以管理你们的相处。</Text><AppButton label="返回异宠" onPress={() => router.replace("/pet" as Href)} /></View>;
  return <>{children}</>;
}
