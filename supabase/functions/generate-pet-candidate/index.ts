import { z } from "npm:zod@4";
import { runInBackground } from "../_shared/background.ts";
import { optionsResponse } from "../_shared/cors.ts";
import { assertImageGenerationAllowed, assertStructuredPetOnboardingAllowed } from "../_shared/demoSettings.ts";
import { sha256 } from "../_shared/hash.ts";
import { ImageModelAdapter, TextModelAdapter, imageExtension, type GeneratedImage } from "../_shared/modelAdapters.ts";
import { buildPixelPetPrompt } from "../_shared/petVisualPrompt.ts";
import { finishModelRun, reserveModelRun } from "../_shared/quota.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({
  instruction: z.string().trim().min(1).max(2000).optional(),
  base_asset_id: z.string().uuid().nullable().optional(),
  explore: z.boolean().default(false),
  request_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  expectations: z.object({
    appearance: z.string().trim().min(4).max(2000),
    personality: z.string().trim().min(2).max(2000),
    companionship: z.string().trim().min(2).max(2000),
    excluded_features: z.string().trim().max(1200).default(""),
    additional_description: z.string().trim().max(2000).default(""),
  }).optional(),
});

type GenerationWork = Readonly<{
  sessionId: string;
  runId: string;
  userId: string;
  petId: string;
  parentId: string | null;
  prompt: string;
  signals: readonly Record<string, unknown>[];
}>;

async function parentImage(client: ReturnType<typeof serviceClient>, petId: string, assetId: string): Promise<GeneratedImage> {
  const asset = await client.from("pet_visual_assets").select("storage_path,is_draft").eq("id", assetId).eq("pet_id", petId).single();
  if (asset.error || !asset.data.is_draft) throw new Error("base_draft_asset_invalid");
  const { data, error } = await client.storage.from("pet-portraits").download(asset.data.storage_path);
  if (error) throw error;
  const type = data.type;
  const mimeType: GeneratedImage["mimeType"] = type === "image/jpeg" || type === "image/webp" || type === "image/svg+xml" ? type : "image/png";
  return { bytes: new Uint8Array(await data.arrayBuffer()), mimeType };
}

async function runGeneration(work: GenerationWork): Promise<void> {
  const client = serviceClient();
  const startedAt = Date.now();
  let storedPath: string | null = null;
  try {
    const current = await client.from("pet_generation_sessions").select("attempts,status").eq("id", work.sessionId).single();
    if (current.error) throw current.error;
    if (current.data.status === "succeeded") return;
    const claimed = await client.from("pet_generation_sessions").update({ status: "running", attempts: Math.min(2, Number(current.data.attempts ?? 0) + 1), error_code: null, completed_at: null }).eq("id", work.sessionId).eq("status", "queued").select("id").maybeSingle();
    if (claimed.error) throw claimed.error;
    if (!claimed.data) return;
    const parent = work.parentId ? await parentImage(client, work.petId, work.parentId) : null;
    const generated = await new ImageModelAdapter().generateCandidate({ prompt: work.prompt, parent });
    storedPath = `${work.userId}/${work.petId}/${crypto.randomUUID()}.${imageExtension(generated.mimeType)}`;
    const upload = await client.storage.from("pet-portraits").upload(storedPath, generated.bytes, { contentType: generated.mimeType, upsert: false });
    if (upload.error) throw upload.error;
    const latestPet = await client.from("pets").select("status").eq("id", work.petId).single();
    if (latestPet.error) throw latestPet.error;
    if (latestPet.data.status === "confirmed") throw new Error("pet_confirmed_while_generation_was_running");
    const promptHash = await sha256(work.prompt);
    const asset = await client.from("pet_visual_assets").insert({
      pet_id: work.petId,
      owner_id: work.userId,
      storage_path: storedPath,
      parent_asset_id: work.parentId,
      generation_session_id: work.sessionId,
      style_snapshot: work.signals,
      prompt_hash: promptHash,
      is_draft: true,
    }).select("id").single();
    if (asset.error) throw asset.error;
    await client.from("pets").update({ status: "drafting", updated_at: new Date().toISOString() }).eq("id", work.petId).neq("status", "confirmed");
    await client.from("pet_generation_sessions").update({ status: "succeeded", error_code: null, completed_at: new Date().toISOString() }).eq("id", work.sessionId);
    await finishModelRun(client, work.runId, { status: "succeeded", startedAt });
  } catch (reason) {
    if (storedPath) await client.storage.from("pet-portraits").remove([storedPath]);
    const errorCode = reason instanceof Error ? reason.message.slice(0, 120) : "unknown";
    await client.from("pet_generation_sessions").update({ status: "failed", error_code: errorCode, completed_at: new Date().toISOString() }).eq("id", work.sessionId);
    await finishModelRun(client, work.runId, { status: "failed", startedAt, errorCode });
  }
}

async function buildWork(userId: string, input: z.infer<typeof Input>): Promise<GenerationWork & { status: string }> {
  const client = serviceClient();
  await assertStructuredPetOnboardingAllowed(client);
  const petResult = await client.from("pets").select("id,name,status").eq("owner_id", userId).single();
  if (petResult.error) throw petResult.error;
  const pet = petResult.data;
  if (pet.status === "confirmed") throw new Error("initial_editing_permanently_closed");

  let instruction = input.instruction ?? (input.expectations ? "按这份期待生成第一版异宠" : undefined);
  let parentId = input.base_asset_id ?? null;
  let explore = input.explore;
  let sessionId = input.session_id ?? "";
  let runId = "";

  if (input.session_id) {
    const existing = await client.from("pet_generation_sessions").select("*").eq("id", input.session_id).eq("owner_id", userId).single();
    if (existing.error) throw existing.error;
    if (existing.data.status === "succeeded" || existing.data.status === "running" || existing.data.status === "queued") {
      return { sessionId: existing.data.id, runId: existing.data.model_run_id, userId, petId: pet.id, parentId: existing.data.base_asset_id, prompt: "", signals: [], status: existing.data.status };
    }
    if (Number(existing.data.attempts) >= 2) throw new Error("generation_retry_limit_reached");
    instruction = existing.data.instruction;
    parentId = existing.data.base_asset_id;
    explore = existing.data.explore;
    runId = existing.data.model_run_id;
    await client.from("model_runs").update({ status: "running", attempts: Number(existing.data.attempts) + 1, error_code: null, completed_at: null }).eq("id", runId);
    await client.from("pet_generation_sessions").update({ status: "queued", error_code: null, completed_at: null }).eq("id", sessionId);
  } else {
    if (!instruction) throw new Error("instruction_required");
    await assertImageGenerationAllowed(client);
    if (parentId && !explore) {
      const base = await client.from("pet_visual_assets").select("id").eq("id", parentId).eq("pet_id", pet.id).eq("is_draft", true).single();
      if (base.error) throw new Error("base_draft_asset_invalid");
    } else if (explore) parentId = null;
  }

  if (input.expectations && !input.session_id) {
    const startedAt = Date.now();
    const seedPromptHash = await sha256(JSON.stringify(input.expectations));
    const seedRunId = await reserveModelRun(client, { runKind: "pet_seed_compose", dailyLimit: 20, ownerId: userId, petId: pet.id, promptHash: seedPromptHash, model: TextModelAdapter.modelName() });
    try {
      const compiled = await new TextModelAdapter().composePetSeed({
        name: pet.name,
        appearance: input.expectations.appearance,
        personality: input.expectations.personality,
        companionship: input.expectations.companionship,
        excludedFeatures: input.expectations.excluded_features,
        additionalDescription: input.expectations.additional_description,
      });
      const saved = await client.from("pet_expectation_drafts").upsert({
        pet_id: pet.id, owner_id: userId,
        appearance_expectation: input.expectations.appearance,
        personality_expectation: input.expectations.personality,
        companionship_expectation: input.expectations.companionship,
        excluded_features: input.expectations.excluded_features,
        additional_description: input.expectations.additional_description,
        ...compiled, updated_at: new Date().toISOString(),
      }, { onConflict: "pet_id" });
      if (saved.error) throw saved.error;
      await finishModelRun(client, seedRunId, { status: "succeeded", startedAt });
    } catch (reason) {
      await finishModelRun(client, seedRunId, { status: "failed", startedAt, errorCode: reason instanceof Error ? reason.message : "pet_seed_compose_failed" });
      throw reason;
    }
  }

  const draftResult = await client.from("pet_expectation_drafts").select("appearance_expectation,personality_expectation,companionship_expectation,excluded_features,additional_description,personality_seed_prompt,visual_seed_prompt,negative_seed_prompt,seed_summary").eq("pet_id", pet.id).single();
  if (draftResult.error || !draftResult.data.personality_seed_prompt || !draftResult.data.visual_seed_prompt) throw new Error("structured_pet_expectations_required");
  const draft = draftResult.data;

  const signalResult = await client.from("pet_style_signals").select("tendency,rationale,confidence,pet_style_feedback(feedback_kind,correction)").eq("pet_id", pet.id).eq("active", true).order("created_at", { ascending: false }).limit(20);
  if (signalResult.error) throw signalResult.error;
  const signals = (signalResult.data ?? []).filter((signal: Record<string, any>) => signal.pet_style_feedback?.[0]?.feedback_kind !== "forgotten");
  const prompt = buildPixelPetPrompt({
    name: pet.name,
    visualSeed: draft.visual_seed_prompt,
    personalitySeed: draft.personality_seed_prompt,
    seedSummary: draft.seed_summary,
    instruction,
    negativeSeed: draft.negative_seed_prompt,
    signals: signals.map((signal: Record<string, any>) => `${signal.tendency}（${signal.rationale}）`),
    mode: parentId ? "edit" : explore ? "explore" : "initial",
  });
  const promptHash = await sha256(prompt);

  if (!input.session_id) {
    const requestId = input.request_id ?? crypto.randomUUID();
    const duplicate = await client.from("pet_generation_sessions").select("id,status,model_run_id,base_asset_id").eq("owner_id", userId).eq("request_id", requestId).maybeSingle();
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data) return { sessionId: duplicate.data.id, runId: duplicate.data.model_run_id, userId, petId: pet.id, parentId: duplicate.data.base_asset_id, prompt, signals, status: duplicate.data.status };
    const generation = await client.from("pet_generation_sessions").insert({ pet_id: pet.id, owner_id: userId, status: "queued", instruction, base_asset_id: parentId, explore, prompt_hash: promptHash, request_id: requestId }).select("id").single();
    if (generation.error?.code === "23505") {
      const raced = await client.from("pet_generation_sessions").select("id,status,model_run_id,base_asset_id").eq("owner_id", userId).eq("request_id", requestId).single();
      if (raced.error) throw raced.error;
      return { sessionId: raced.data.id, runId: raced.data.model_run_id, userId, petId: pet.id, parentId: raced.data.base_asset_id, prompt, signals, status: raced.data.status };
    }
    if (generation.error) throw generation.error;
    sessionId = generation.data.id;
    try {
      runId = await reserveModelRun(client, { runKind: "initial_image", dailyLimit: 20, ownerId: userId, petId: pet.id, promptHash, model: ImageModelAdapter.modelName() });
      await client.from("pet_generation_sessions").update({ model_run_id: runId }).eq("id", sessionId);
    } catch (reason) {
      await client.from("pet_generation_sessions").delete().eq("id", sessionId);
      throw reason;
    }
  }

  return { sessionId, runId, userId, petId: pet.id, parentId, prompt, signals, status: "queued" };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const user = await authenticatedUser(request);
    const input = Input.parse(await request.json());
    const work = await buildWork(user.id, input);
    if (work.status === "queued" && work.prompt) runInBackground(runGeneration(work));
    return json(request, { session_id: work.sessionId, status: work.status }, 202);
  } catch (reason) {
    return errorResponse(request, reason);
  }
});
