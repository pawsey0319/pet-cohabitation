import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function triggerAutomaticEvolution(client: SupabaseClient, petId: string): Promise<string | null> {
  const evaluated = await client.rpc("evaluate_pet_evolution", { target_pet_id: petId });
  if (evaluated.error) throw evaluated.error;
  const event = evaluated.data as { id?: string } | null;
  if (!event?.id) return null;
  const base = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!base || !serviceKey) throw new Error("automatic_evolution_environment_missing");
  const response = await fetch(`${base}/functions/v1/evolve-pet`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ event_id: event.id, continuity_repair: false, internal_auto: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const errorCode = `automatic_evolution_dispatch_${response.status}`;
    await client.from("pet_evolution_events").update({ status: "failed", error_code: errorCode, completed_at: new Date().toISOString() }).eq("id", event.id).eq("status", "queued");
    throw new Error(errorCode);
  }
  return event.id;
}
