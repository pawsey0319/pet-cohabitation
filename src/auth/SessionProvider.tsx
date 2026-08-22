import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { isLocalDemoMode, requireSupabase, supabase } from "../lib/supabase";
import type { AppProfile } from "../data/types";

const LOCAL_PROFILE_KEY = "pet-cohabitation-local-profile-v2";
const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";

type SessionValue = Readonly<{
  profile: AppProfile | null;
  isLoading: boolean;
  isLocalDemo: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: { inviteCode: string; email: string; password: string; nickname: string }): Promise<void>;
  logout(): Promise<void>;
  refreshProfile(): Promise<void>;
}>;

const SessionContext = createContext<SessionValue | null>(null);

function profileFromUser(user: User, row?: Record<string, unknown> | null): AppProfile {
  return {
    id: user.id,
    email: user.email ?? "",
    nickname: typeof row?.nickname === "string"
      ? row.nickname
      : typeof user.user_metadata.nickname === "string"
        ? user.user_metadata.nickname
        : user.email?.split("@")[0] ?? "新朋友",
    avatarUrl: typeof row?.avatar_url === "string" ? row.avatar_url : null,
    isAdmin: row?.is_admin === true,
  };
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadRemoteProfile = useCallback(async (user: User | null) => {
    if (!user) {
      setProfile(null);
      return;
    }
    const client = requireSupabase();
    const { data } = await client.from("profiles").select("nickname, avatar_url, is_admin").eq("id", user.id).maybeSingle();
    setProfile(profileFromUser(user, data));
  }, []);

  useEffect(() => {
    let mounted = true;
    if (isLocalDemoMode) {
      void AsyncStorage.getItem(LOCAL_PROFILE_KEY).then((raw) => {
        if (!mounted) return;
        setProfile(raw ? JSON.parse(raw) as AppProfile : null);
        setIsLoading(false);
      });
      return () => { mounted = false; };
    }

    void supabase!.auth.getUser().then(({ data }) => loadRemoteProfile(data.user)).finally(() => {
      if (mounted) setIsLoading(false);
    });
    const { data: listener } = supabase!.auth.onAuthStateChange((_event, session) => {
      if (mounted) void loadRemoteProfile(session?.user ?? null);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [loadRemoteProfile]);

  const login = useCallback(async (email: string, password: string) => {
    if (isLocalDemoMode) {
      const local: AppProfile = { id: LOCAL_USER_ID, email, nickname: email.split("@")[0] || "体验用户", isAdmin: true };
      await AsyncStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(local));
      setProfile(local);
      return;
    }
    const { error } = await requireSupabase().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const register = useCallback(async (input: { inviteCode: string; email: string; password: string; nickname: string }) => {
    if (isLocalDemoMode) {
      const local: AppProfile = { id: LOCAL_USER_ID, email: input.email, nickname: input.nickname.trim() || "体验用户", isAdmin: true };
      await AsyncStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(local));
      setProfile(local);
      return;
    }
    const client = requireSupabase();
    const { data, error } = await client.functions.invoke("register-with-invite", { body: input });
    if (error) throw error;
    if (!data?.access_token || !data?.refresh_token) throw new Error("注册成功但未取得登录会话");
    const { error: sessionError } = await client.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
    if (sessionError) throw sessionError;
  }, []);

  const logout = useCallback(async () => {
    if (isLocalDemoMode) {
      await AsyncStorage.removeItem(LOCAL_PROFILE_KEY);
      setProfile(null);
      return;
    }
    const { error } = await requireSupabase().auth.signOut();
    if (error) throw error;
  }, []);

  const value = useMemo<SessionValue>(() => ({
    profile,
    isLoading,
    isLocalDemo: isLocalDemoMode,
    login,
    register,
    logout,
    refreshProfile: async () => {
      if (isLocalDemoMode) return;
      const { data } = await requireSupabase().auth.getUser();
      await loadRemoteProfile(data.user);
    },
  }), [isLoading, loadRemoteProfile, login, logout, profile, register]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
