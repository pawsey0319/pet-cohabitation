import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function assertQuota(client: SupabaseClient, input: {
  runKind: string;
  dailyLimit: number;
  ownerId?: string | null;
  spaceId?: string | null;
}): Promise<void> {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  let query = client.from("model_runs").select("id", { count: "exact", head: true }).eq("run_kind", input.runKind).gte("created_at", start.toISOString());
  query = input.spaceId ? query.eq("space_id", input.spaceId) : query.eq("owner_id", input.ownerId!);
  const { count, error } = await query;
  if (error) throw error;
  if ((count ?? 0) >= input.dailyLimit) throw new Error(`quota_exceeded:${input.runKind}`);
}

export async function createModelRun(client: SupabaseClient, input: {
  runKind: string;
  ownerId?: string | null;
  spaceId?: string | null;
  petId?: string | null;
  promptHash?: string | null;
  model?: string | null;
}): Promise<string> {
  const { data, error } = await client.from("model_runs").insert({
    run_kind: input.runKind, owner_id: input.ownerId ?? null, space_id: input.spaceId ?? null,
    pet_id: input.petId ?? null, prompt_hash: input.promptHash ?? null,
    provider: Deno.env.get("MODEL_MOCK_MODE") === "true" ? "mock" : "openai-compatible",
    model: input.model ?? null, status: "running",
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

export async function reserveModelRun(client: SupabaseClient, input: {
  runKind: string;
  dailyLimit: number;
  ownerId?: string | null;
  spaceId?: string | null;
  petId?: string | null;
  promptHash?: string | null;
  model?: string | null;
}): Promise<string> {
  const { data, error } = await client.rpc("reserve_model_run", {
    target_run_kind: input.runKind,
    target_daily_limit: input.dailyLimit,
    target_owner_id: input.ownerId ?? null,
    target_space_id: input.spaceId ?? null,
    target_pet_id: input.petId ?? null,
    target_prompt_hash: input.promptHash ?? null,
    target_provider: Deno.env.get("MODEL_MOCK_MODE") === "true" ? "mock" : "openai-compatible",
    target_model: input.model ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function finishModelRun(client: SupabaseClient, runId: string, input: { status: "succeeded" | "failed" | "blocked"; startedAt: number; errorCode?: string | null }): Promise<void> {
  await client.from("model_runs").update({ status: input.status, latency_ms: Date.now() - input.startedAt, error_code: input.errorCode ?? null, completed_at: new Date().toISOString() }).eq("id", runId);
}
