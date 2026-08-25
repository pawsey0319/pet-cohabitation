import { z } from "npm:zod@4";
import { triggerAutomaticEvolution } from "../_shared/autoEvolution.ts";
import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({ limit: z.number().int().min(1).max(100).default(100) });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const secret = request.headers.get("x-evolution-sweep-secret") ?? "";
    if (!secret || secret !== Deno.env.get("DEMO_PURGE_SECRET")) throw new Error("evolution_sweep_unauthorized");
    const input = Input.parse(await request.json().catch(() => ({})));
    const client = serviceClient();
    const pets = await client.from("pets").select("id").eq("status", "confirmed").limit(input.limit);
    if (pets.error) throw pets.error;
    const triggered: string[] = [];
    for (const pet of pets.data ?? []) {
      try { const eventId = await triggerAutomaticEvolution(client, pet.id); if (eventId) triggered.push(eventId); }
      catch { /* One unavailable model or pet must not stop the daily sweep. */ }
    }
    return json(request, { checked: pets.data?.length ?? 0, triggered });
  } catch (reason) { return errorResponse(request, reason); }
});
