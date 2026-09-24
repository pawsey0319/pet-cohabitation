import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({ action: z.enum(["state", "decide"]), space_id: z.string().uuid(), pet_id: z.string().uuid(), decision: z.boolean().optional() });
Deno.serve(async request => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const user = await authenticatedUser(request), input = Input.parse(await request.json()), client = serviceClient();
    const membership = await client.rpc("is_space_member", { target_space_id: input.space_id, target_user_id: user.id });
    if (membership.error || !membership.data) throw new Error("not_space_member");
    const pet = await client.from("pets").select("id,owner_id,name").eq("id", input.pet_id).single();
    if (pet.error) throw pet.error;
    const ownerMembership = await client.rpc("is_space_member", { target_space_id: input.space_id, target_user_id: pet.data.owner_id });
    if (ownerMembership.error || !ownerMembership.data) throw new Error("pet_not_in_space");
    if (input.action === "decide") {
      if (input.decision === undefined) throw new Error("relationship_consent_decision_required");
      const changed = await client.rpc("set_pet_relationship_consent", { p_actor: user.id, p_pet: input.pet_id, p_space: input.space_id, p_decision: input.decision });
      if (changed.error) throw changed.error;
    }
    const [scope, votes, members, enabled] = await Promise.all([
      client.from("pet_relationship_scopes").select("epoch,revision,enabled_at").eq("pet_id", input.pet_id).eq("space_id", input.space_id).maybeSingle(),
      client.from("pet_relationship_consents").select("member_id,epoch,consented,decided_at").eq("pet_id", input.pet_id).eq("space_id", input.space_id),
      client.from("space_members").select("user_id,profiles(nickname)").eq("space_id", input.space_id),
      client.rpc("pet_relationship_enabled", { p_pet: input.pet_id, p_space: input.space_id }),
    ]);
    for (const result of [scope, votes, members, enabled]) if (result.error) throw result.error;
    return json(request, { pet: pet.data, scope: scope.data, votes: votes.data, members: members.data, enabled: enabled.data === true });
  } catch (reason) { return errorResponse(request, reason); }
});
