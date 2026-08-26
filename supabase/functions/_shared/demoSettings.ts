import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type DemoSettings = Readonly<{
  registration_enabled: boolean;
  image_generation_enabled: boolean;
  implicit_pet_replies_enabled: boolean;
  agent_workbench_enabled: boolean;
  structured_pet_onboarding_enabled: boolean;
  max_registered_users: number;
  global_daily_image_limit: number;
  test_ends_at: string | null;
  purge_after_days: number;
}>;

export async function loadDemoSettings(client: SupabaseClient): Promise<DemoSettings> {
  const { data, error } = await client.from("demo_settings").select("registration_enabled,image_generation_enabled,implicit_pet_replies_enabled,agent_workbench_enabled,structured_pet_onboarding_enabled,max_registered_users,global_daily_image_limit,test_ends_at,purge_after_days").eq("id", true).single();
  if (error) throw error;
  return data as DemoSettings;
}

export async function assertRegistrationAllowed(client: SupabaseClient): Promise<void> {
  const settings = await loadDemoSettings(client);
  if (!settings.registration_enabled) throw new Error("registration_paused");
  if (settings.test_ends_at && Date.parse(settings.test_ends_at) <= Date.now()) throw new Error("demo_test_ended");
  const { count, error } = await client.from("profiles").select("id", { count: "exact", head: true });
  if (error) throw error;
  if ((count ?? 0) >= settings.max_registered_users) throw new Error("demo_user_limit_reached");
}

export async function assertImageGenerationAllowed(client: SupabaseClient): Promise<void> {
  const settings = await loadDemoSettings(client);
  if (!settings.image_generation_enabled) throw new Error("image_generation_paused");
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count, error } = await client.from("model_runs").select("id", { count: "exact", head: true }).in("run_kind", ["initial_image", "major_evolution"]).gte("created_at", start.toISOString());
  if (error) throw error;
  if ((count ?? 0) >= settings.global_daily_image_limit) throw new Error("global_image_quota_exceeded");
}

export async function assertAgentWorkbenchAllowed(client: SupabaseClient): Promise<void> {
  const settings = await loadDemoSettings(client);
  if (!settings.agent_workbench_enabled) throw new Error("agent_workbench_paused");
}

export async function assertStructuredPetOnboardingAllowed(client: SupabaseClient): Promise<void> {
  const settings = await loadDemoSettings(client);
  if (!settings.structured_pet_onboarding_enabled) throw new Error("structured_pet_onboarding_paused");
}
