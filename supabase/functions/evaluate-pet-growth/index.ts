import { z } from "npm:zod@4";
import { triggerAutomaticEvolution } from "../_shared/autoEvolution.ts";
import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({ pet_id: z.string().uuid() }).strict();

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const user = await authenticatedUser(request);
    const input = Input.parse(await request.json());
    const client = serviceClient();
    const pet = await client.from("pets").select("id").eq("id", input.pet_id).eq("owner_id", user.id).single();
    if (pet.error) throw pet.error;
    const eventId = await triggerAutomaticEvolution(client, input.pet_id);
    return json(request, { eligible: Boolean(eventId), event_id: eventId });
  } catch (reason) { return errorResponse(request, reason); }
});
