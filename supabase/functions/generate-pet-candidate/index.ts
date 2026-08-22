import { z } from "npm:zod@4";
import { runInBackground } from "../_shared/background.ts";
import { optionsResponse } from "../_shared/cors.ts";
import { assertImageGenerationAllowed } from "../_shared/demoSettings.ts";
import { sha256 } from "../_shared/hash.ts";
import { ImageModelAdapter, imageExtension, type GeneratedImage } from "../_shared/modelAdapters.ts";
import { finishModelRun, reserveModelRun } from "../_shared/quota.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({
  instruction: z.string().trim().min(1).max(2000).optional(),
  base_asset_id: z.string().uuid().nullable().optional(),
  explore: z.boolean().default(false),
  request_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
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
  const petResult = await client.from("pets").select("id,name,status").eq("owner_id", userId).single();
  if (petResult.error) throw petResult.error;
  const pet = petResult.data;
  if (pet.status === "confirmed") throw new Error("initial_editing_permanently_closed");

  let instruction = input.instruction;
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
    const { count, error: turnError } = await client.from("pet_private_threads").select("id", { count: "exact", head: true }).eq("pet_id", pet.id).eq("role", "owner");
    if (turnError) throw turnError;
    if ((count ?? 0) < 5) throw new Error("five_incubation_turns_required");
    if (parentId && !explore) {
      const base = await client.from("pet_visual_assets").select("id").eq("id", parentId).eq("pet_id", pet.id).eq("is_draft", true).single();
      if (base.error) throw new Error("base_draft_asset_invalid");
    } else if (explore) parentId = null;
  }

  const signalResult = await client.from("pet_style_signals").select("tendency,rationale,confidence,pet_style_feedback(feedback_kind,correction)").eq("pet_id", pet.id).eq("active", true).order("created_at", { ascending: false }).limit(20);
  if (signalResult.error) throw signalResult.error;
  const signals = (signalResult.data ?? []).filter((signal: Record<string, any>) => signal.pet_style_feedback?.[0]?.feedback_kind !== "forgotten");
  const prompt = [
    `为一只名叫“${pet.name}”的唯一成长型异宠创作独立原创肖像。`,
    "不采用预设统一画风；从主人的相处信号自然形成材质、色彩、气质、器官与构图。禁止模仿现有 IP、受保护角色或在世艺术家的明确风格。画面只包含异宠本体，不含文字、水印和人物。",
    parentId ? "这是确认前的连续修改：保留当前候选可识别的生命关系，同时按反馈调整；不是完全无关的重绘。" : explore ? "这是确认前重新探索的新方向，可以与旧候选明显不同。" : "这是它的第一张外观候选。",
    `主人本轮意见：${instruction}`,
    `相处信号：${signals.map((signal: Record<string, any>) => `${signal.tendency}（${signal.rationale}）`).join("；") || "尚少，保持开放、奇异且不过度卖萌"}`,
    "生成适合移动端展示的方形单体肖像，视觉完整、背景简洁。",
  ].join("\n");
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
