import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export const isSupabaseConfigured = Boolean(url && publishableKey);
export const isLocalDemoMode = process.env.EXPO_PUBLIC_DEMO_MODE === "true" || !isSupabaseConfigured;

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, publishableKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === "web",
      },
      realtime: { params: { eventsPerSecond: 8 } },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error("尚未配置 Supabase。请复制 .env.example 为 .env.local 并填写项目参数。");
  }
  return supabase;
}
