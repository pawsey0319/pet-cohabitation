import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({ asset_id: z.string().uuid() });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request); const user = await authenticatedUser(request); const input = Input.parse(await request.json());
    const { error } = await serviceClient().rpc("confirm_pet_asset", { target_owner: user.id, target_asset: input.asset_id });
    if (error) throw error;
    return json(request, { confirmed: true });
  } catch (reason) { return errorResponse(request, reason); }
});
