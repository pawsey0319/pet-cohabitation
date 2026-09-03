import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
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
  const activeUserIdRef = useRef<string | null>(null);
  const scheduledProfileRefreshRef = useRef<string | null>(null);

  useEffect(() => {
    if (isLocalDemoMode || Platform.OS === "web") return;
    const auth = requireSupabase().auth;
    const syncRefresh = (state: AppStateStatus) => {
      if (state === "active") auth.startAutoRefresh();
      else auth.stopAutoRefresh();
    };
    auth.startAutoRefresh();
    const listener = AppState.addEventListener("change", syncRefresh);
    return () => {
      listener?.remove();
      auth.stopAutoRefresh();
    };
  }, []);

  const loadRemoteProfile = useCallback(async (user: User | null) => {
    if (!user) {
      if (activeUserIdRef.current === null) setProfile(null);
      return;
    }
    const client = requireSupabase();
    const { data } = await client.from("profiles").select("nickname, avatar_url, is_admin").eq("id", user.id).maybeSingle();
    if (activeUserIdRef.current === user.id) setProfile(profileFromUser(user, data));
  }, []);

  const adoptRemoteUser = useCallback((user: User | null, refresh = true) => {
    activeUserIdRef.current = user?.id ?? null;
    setProfile(user ? profileFromUser(user) : null);
    if (user && refresh && scheduledProfileRefreshRef.current !== user.id) {
      // Defer the authoritative profile row so navigation is never held behind
      // a second cross-border request after Auth has already succeeded.
      scheduledProfileRefreshRef.current = user.id;
      setTimeout(() => {
        void loadRemoteProfile(user).catch(() => undefined).finally(() => {
          if (scheduledProfileRefreshRef.current === user.id) scheduledProfileRefreshRef.current = null;
        });
      }, 0);
    }
  }, [loadRemoteProfile]);

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

    // getSession reads the locally persisted, signed session first. Server-side
    // RLS still validates every subsequent request; boot navigation need not
    // wait for the remote getUser endpoint on a slow mobile connection.
    void supabase!.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      adoptRemoteUser(data.session?.user ?? null);
    }).catch(() => {
      if (mounted) adoptRemoteUser(null, false);
    }).finally(() => {
      if (mounted) setIsLoading(false);
    });
    const { data: listener } = supabase!.auth.onAuthStateChange((_event, session) => {
      if (mounted) adoptRemoteUser(session?.user ?? null);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [adoptRemoteUser]);

  const login = useCallback(async (email: string, password: string) => {
    if (isLocalDemoMode) {
      const local: AppProfile = { id: LOCAL_USER_ID, email, nickname: email.split("@")[0] || "体验用户", isAdmin: true };
      await AsyncStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(local));
      setProfile(local);
      return;
    }
    const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password });
    if (error) throw error;
    adoptRemoteUser(data.user);
  }, [adoptRemoteUser]);

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
    const { data: sessionData, error: sessionError } = await client.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
    if (sessionError) throw sessionError;
    adoptRemoteUser(sessionData.user);
  }, [adoptRemoteUser]);

  const logout = useCallback(async () => {
    if (isLocalDemoMode) {
      await AsyncStorage.removeItem(LOCAL_PROFILE_KEY);
      setProfile(null);
      return;
    }
    const { error } = await requireSupabase().auth.signOut();
    if (error) throw error;
    adoptRemoteUser(null, false);
  }, [adoptRemoteUser]);

  const value = useMemo<SessionValue>(() => ({
    profile,
    isLoading,
    isLocalDemo: isLocalDemoMode,
    login,
    register,
    logout,
    refreshProfile: async () => {
      if (isLocalDemoMode) return;
      const { data } = await requireSupabase().auth.getSession();
      await loadRemoteProfile(data.session?.user ?? null);
    },
  }), [isLoading, loadRemoteProfile, login, logout, profile, register]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
