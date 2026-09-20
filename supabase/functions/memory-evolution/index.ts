import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";
import { processCompanionLifeJobs } from "../_shared/companionMemoryEvolution.ts";
import { runInBackground } from "../_shared/background.ts";

Deno.serve(async request => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const user = await authenticatedUser(request);
    const input = await request.json();
    if (!input || typeof input !== "object" || JSON.stringify(input).length > 14000) throw new Error("invalid_memory_input");
    const client = serviceClient();
    const pet = await client.from("pets").select("id").eq("owner_id", user.id).single();
    if (pet.error) throw pet.error;
    if (input.action === "retry") {
      // Ownership is resolved by server. Original sources and leases are reused;
      // history is never bulk-extracted and forgotten jobs remain cancelled.
      runInBackground(processCompanionLifeJobs(client, pet.data.id).catch(() => undefined));
      return json(request, { outcome: "queued" });
    }
    const names: Record<string, { rpc: string; args: Record<string, unknown> }> = {
      context: { rpc: "get_companion_memory_context", args: { target_pet_id: pet.data.id, topic_started_at: input.topic_started_at ?? null, query_text: String(input.query ?? "").slice(0, 4000) } },
      preview_forget: { rpc: "preview_life_memory_forget", args: { target_fact: input.fact_id } },
      review: { rpc: "get_companion_review", args: { days: input.days ?? 7 } },
      continuation: { rpc: "get_companion_continuation", args: {} },
    };
    const operation = names[input.action] ?? { rpc: "manage_memory_evolution", args: { command: input } };
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/${operation.rpc}`, {
      method: "POST", headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", Authorization: request.headers.get("authorization")!, "Content-Type": "application/json" },
      body: JSON.stringify(operation.args), signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json();
    if (!response.ok) return json(request, { error: String(payload.message ?? "memory_operation_failed") }, String(payload.message).includes("conflict") ? 409 : response.status);
    return json(request, payload);
  } catch (reason) { return errorResponse(request, reason); }
});
