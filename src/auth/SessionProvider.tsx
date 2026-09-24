import { clearAvatarLocalData } from "../avatars/repository";
import { clearReadState } from "../chat/readState";
import { desktopPetKeepsSessionActive, getDesktopPetModule, stopDesktopPetForAccount } from "../desktopPet/native";
import { stopChatDelivery, clearChatDelivery } from "../chat/deliveryRuntime";
import { stopSystemVoice } from "../voice/native";
import { abortAllPrivateStreams } from "../pets/streamClient";
import { clearPrivateSendQueue } from "../pets/privateSendQueue";
import { clearPetPortraitPosition } from "../pets/portraitPosition";
import { clearWorkData } from "../work/repository";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { isLocalDemoMode, requireSupabase, supabase } from "../lib/supabase";
import type { AppProfile } from "../data/types";
import { clearMediaCache } from "../chat/mediaCache";
import { clearAccountMessageCaches } from "../chat/messageSync";
import { clearNotificationLocalData, unregisterCurrentPushDevice } from "../notifications/lifecycle";

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
  const accountTransitionRef = useRef(0);
  const pendingWindowCloseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (isLocalDemoMode || Platform.OS === "web") return;
    const auth = requireSupabase().auth;
    let revision = 0;
    const syncRefresh = (state: AppStateStatus) => {
      const current = ++revision;
      if (state === "active") { auth.startAutoRefresh(); return; }
      void desktopPetKeepsSessionActive().then(running => {
        if (current !== revision) return;
        if (running) auth.startAutoRefresh(); else auth.stopAutoRefresh();
      }).catch(() => { if (current === revision) auth.stopAutoRefresh(); });
    };
    auth.startAutoRefresh();
    const listener = AppState.addEventListener("change", syncRefresh);
    const desktopListener = getDesktopPetModule()?.addListener("onDesktopPetState", () => syncRefresh(AppState.currentState));
    return () => {
      revision++;
      listener?.remove();
      desktopListener?.remove();
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
    const previous=activeUserIdRef.current;
    const transition = ++accountTransitionRef.current;
    const commit = () => {
      if (transition !== accountTransitionRef.current) return;
      activeUserIdRef.current = user?.id ?? null;
      setProfile(user ? profileFromUser(user) : null);
      if (user && refresh && scheduledProfileRefreshRef.current !== user.id) {
        scheduledProfileRefreshRef.current = user.id;
        setTimeout(() => {
          if (activeUserIdRef.current !== user.id) {
            if (scheduledProfileRefreshRef.current === user.id) scheduledProfileRefreshRef.current = null;
            return;
          }
          void loadRemoteProfile(user).catch(() => undefined).finally(() => {
            if (scheduledProfileRefreshRef.current === user.id) scheduledProfileRefreshRef.current = null;
          });
        }, 0);
      }
    };
    if(previous && previous!==user?.id){
      // Keep the new account's UI hidden until the old native window is gone.
      // Do not await inside Supabase's synchronous auth event callback.
      activeUserIdRef.current = null;
      setProfile(null);
      stopChatDelivery(previous);
      abortAllPrivateStreams();void stopSystemVoice();
      void Promise.allSettled([clearChatDelivery(previous),clearAvatarLocalData(previous),clearReadState(previous),clearPrivateSendQueue(previous),clearPetPortraitPosition(previous),clearWorkData(previous),clearAccountMessageCaches(previous),clearNotificationLocalData(previous),clearMediaCache(previous)]);
      const close = stopDesktopPetForAccount(previous);
      pendingWindowCloseRef.current = close;
      void close.then(() => {
        if (pendingWindowCloseRef.current === close) pendingWindowCloseRef.current = null;
        commit();
      }).catch(() => { /* Fail closed: do not show the next account over an old window. */ });
      return;
    }
    if (pendingWindowCloseRef.current) void pendingWindowCloseRef.current.then(commit).catch(() => undefined);
    else commit();
  }, [loadRemoteProfile]);

  useEffect(() => {
    let mounted = true;
    let authEvents = 0;
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
      if (!mounted || authEvents > 0) return;
      adoptRemoteUser(data.session?.user ?? null);
    }).catch(() => {
      if (mounted && authEvents === 0) adoptRemoteUser(null, false);
    }).finally(() => {
      if (mounted) setIsLoading(false);
    });
    const { data: listener } = supabase!.auth.onAuthStateChange((_event, session) => {
      authEvents++;
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
    const ownerId = profile?.id;
    if(ownerId) await stopDesktopPetForAccount(ownerId);
    // A failed device unbind must leave the signed-in app usable. Destructive
    // local cleanup starts only after the fallible remote logout steps succeed.
    if(ownerId && !isLocalDemoMode) await unregisterCurrentPushDevice(ownerId);
    if (isLocalDemoMode) {
      if(ownerId){await clearChatDelivery(ownerId);await clearAvatarLocalData(ownerId);await clearReadState(ownerId);}
      await AsyncStorage.removeItem(LOCAL_PROFILE_KEY);
      abortAllPrivateStreams();void stopSystemVoice();
      if(ownerId)await Promise.all([clearPrivateSendQueue(ownerId),clearPetPortraitPosition(ownerId),clearWorkData(ownerId),clearAccountMessageCaches(ownerId),clearNotificationLocalData(ownerId)]);
      if (ownerId) await clearMediaCache(ownerId).catch(() => undefined);
      setProfile(null);
      return;
    }
    const { error } = await requireSupabase().auth.signOut();
    if (error) throw error;
    adoptRemoteUser(null, false);
  }, [adoptRemoteUser, profile?.id]);

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
