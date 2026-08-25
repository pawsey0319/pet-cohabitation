import { z } from "npm:zod@4";
import { triggerAutomaticEvolution } from "../_shared/autoEvolution.ts";
import { runInBackground } from "../_shared/background.ts";
import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({
  space_id: z.string().uuid(),
  pet_id: z.string().uuid(),
  action: z.enum(["care", "feed", "play"]),
  note: z.string().trim().max(240).optional().default(""),
  request_id: z.string().uuid().optional(),
});

const actionText = { care: "陪它安静待了一会儿", feed: "递给它一份想象中的小点心", play: "和它玩了一场短短的追光游戏" } as const;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const user = await authenticatedUser(request);
    const input = Input.parse(await request.json());
    const client = serviceClient();
    const member = await client.rpc("is_space_member", { target_space_id: input.space_id, target_user_id: user.id });
    if (member.error || !member.data) throw new Error("not_space_member");
    const permission = await client.from("space_pet_permissions").select("participation_enabled,proactive_paused,paused_by_vote,pets!inner(id,name,owner_id,status)").eq("space_id", input.space_id).eq("pet_id", input.pet_id).single();
    if (permission.error) throw permission.error;
    if (!permission.data.participation_enabled || permission.data.proactive_paused || permission.data.paused_by_vote) throw new Error("pet_participation_paused");
    const pet = permission.data.pets as unknown as { id: string; name: string; owner_id: string; status: string };
    if (pet.status !== "confirmed") throw new Error("confirmed_pet_required");
    const actor = await client.from("profiles").select("nickname").eq("id", user.id).single();
    if (actor.error) throw actor.error;
    const content = `${actor.data.nickname}${actionText[input.action]}。${pet.name}${input.action === "feed" ? "把气味认真记了下来" : input.action === "play" ? "学会了一个新的转身动作" : "慢慢放松下来"}${input.note ? `；还听见了：“${input.note}”` : ""}。`;
    const requestId = input.request_id ?? crypto.randomUUID();
    const experience = await client.from("pet_experiences").insert({ pet_id: pet.id, owner_id: pet.owner_id, space_id: input.space_id, category: input.action === "play" ? "social" : "care", summary: content, interaction_key: `space:${user.id}:${requestId}` }).select("id").single();
    if (experience.error) throw experience.error;
    const motion = input.action === "feed" ? "eating" : input.action === "play" ? "playing" : "happy";
    const duration = input.action === "care" ? 8 : 12;
    await client.from("pet_runtime_states").upsert({ pet_id: pet.id, owner_id: pet.owner_id, state: motion, source_kind: "space_action", source_id: experience.data.id, started_at: new Date().toISOString(), expires_at: new Date(Date.now() + duration * 1_000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: "pet_id" });
    const story = await client.from("pet_corner_stories").insert({ space_id: input.space_id, pet_id: pet.id, content }).select("id,space_id,pet_id,content,created_at").single();
    if (story.error) throw story.error;
    runInBackground(triggerAutomaticEvolution(client, pet.id).catch(() => null));
    return json(request, { ...story.data, pet_name: pet.name, experience_id: experience.data.id });
  } catch (reason) {
    return errorResponse(request, reason);
  }
});
