import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";
import { loadPetLearningContext, processPetLearningJobs } from "../_shared/personalityLearning.ts";
import { STYLE_TRAITS } from "../_shared/personalityDomain.ts";
import { runInBackground } from "../_shared/background.ts";

const Input = z.object({
  action: z.enum(["state", "pause", "resume", "reset", "block_trait", "unblock_trait", "forget_evidence", "correct_evidence", "forget_relationship", "correct_relationship", "retry"]),
  request_id: z.string().uuid().optional(), expected_revision: z.number().int().positive().optional(),
  trait: z.enum(STYLE_TRAITS).optional(), evidence_id: z.string().uuid().optional(), relationship_id: z.string().uuid().optional(),
  correction: z.string().trim().min(1).max(200).optional(),
  job_id: z.string().uuid().optional(), space_id: z.string().uuid().optional(), page: z.number().int().min(0).max(10000).default(0),
});

Deno.serve(async request => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const user = await authenticatedUser(request), input = Input.parse(await request.json()), client = serviceClient();
    const pet = await client.from("pets").select("id,seed_summary,personality_summary").eq("owner_id", user.id).single();
    if (pet.error) throw pet.error;
    const blocked = await client.from("notification_owner_blocks").select("owner_id").eq("owner_id", user.id).maybeSingle();
    if (blocked.error || blocked.data) throw new Error("account_deleting");
    if (input.action === "retry") {
      if (!input.job_id) throw new Error("learning_job_required");
      const reset = await client.from("pet_learning_jobs").update({ status: "queued", attempts: 0, lease_token: null, lease_until: null, error_code: null })
        .eq("id", input.job_id).eq("owner_id", user.id).eq("status", "failed").select("id").maybeSingle();
      if (reset.error) throw reset.error;
      if (!reset.data) throw new Error("learning_retry_not_available");
      runInBackground(processPetLearningJobs(client, { petId: pet.data.id }).catch(() => undefined));
      return json(request, { status: "queued" });
    }
    if (input.action !== "state") {
      if (!input.request_id || !input.expected_revision) throw new Error("personality_request_version_required");
      if (["block_trait", "unblock_trait"].includes(input.action) && !input.trait) throw new Error("trait_required");
      if (["forget_evidence", "correct_evidence"].includes(input.action) && !input.evidence_id) throw new Error("evidence_required");
      if (["forget_relationship", "correct_relationship"].includes(input.action) && !input.relationship_id) throw new Error("relationship_required");
      const result = await client.rpc("manage_pet_personality", { p_owner: user.id, p_pet: pet.data.id, p_request: input.request_id, p_payload: input });
      if (result.error) throw result.error;
      return json(request, result.data);
    }
    const context = await loadPetLearningContext(client, pet.data.id);
    const offset = input.page * 30;
    let relations = client.from("pet_group_relationships").select("*").eq("owner_id", user.id).eq("pet_id", pet.data.id).order("source_date", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 29);
    if (input.space_id) relations = relations.eq("space_id", input.space_id);
    const results = await Promise.all([
      client.from("pet_personality_states").select("*").eq("pet_id", pet.data.id).single(),
      client.from("pet_personality_evidence").select("*").eq("pet_id", pet.data.id).order("source_date", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 29),
      client.from("pet_personality_history").select("*").eq("pet_id", pet.data.id).order("created_at", { ascending: false }).range(offset, offset + 29),
      relations,
      client.from("pet_learning_jobs").select("id,kind,source_kind,source_id,space_id,status,attempts,error_code,updated_at").eq("pet_id", pet.data.id).in("status", ["queued", "running", "failed"]).order("created_at", { ascending: false }).limit(30),
    ]);
    for (const result of results) if (result.error) throw result.error;
    // Historical source bodies remain accessible only in their original chat.
    // Forgotten evidence/invalidated relationships cannot reappear as a profile.
    const safeEvidence = (results[1].data ?? []).map((row: any) => row.state === "active" ? row : { ...row, quote: null });
    const safeRelations = (results[3].data ?? []).map((row: any) => ["active", "reported", "pending"].includes(row.state) ? row : { ...row, quote: null, relation: null });
    const allowed = new Set((context.styles ?? []).map(style => style.trait));
    const safeHistory = (results[2].data ?? []).map((row: any) => ({ ...row, previous_styles: [], styles: (row.styles ?? []).filter((style: any) => allowed.has(style.trait)), source_ids: [] }));
    return json(request, { seed: pet.data.seed_summary ?? pet.data.personality_summary, state: results[0].data, evidence: safeEvidence, history: safeHistory, relationships: safeRelations, jobs: results[4].data, page: input.page, page_size: 30 });
  } catch (reason) { return errorResponse(request, reason); }
});
