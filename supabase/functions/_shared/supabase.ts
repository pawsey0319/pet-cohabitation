import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

export function serviceClient(): SupabaseClient {
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase service environment is incomplete");
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function anonClient(): SupabaseClient {
  if (!supabaseUrl || !anonKey) throw new Error("SUPABASE_ANON_KEY is missing");
  return createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function authenticatedUser(request: Request): Promise<User> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("unauthenticated");
  const { data, error } = await serviceClient().auth.getUser(token);
  if (error || !data.user) throw new Error("unauthenticated");
  return data.user;
}

export function requirePost(request: Request): void {
  if (request.method !== "POST") throw new Error("method_not_allowed");
}
