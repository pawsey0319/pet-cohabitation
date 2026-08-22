import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { sha256 } from "../_shared/hash.ts";
import { ImageModelAdapter, imageExtension, type GeneratedImage } from "../_shared/modelAdapters.ts";
import { finishModelRun, reserveModelRun } from "../_shared/quota.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({
  instruction: z.string().trim().min(1).max(2000),
  base_asset_id: z.string().uuid().nullable().optional(),
  explore: z.boolean().default(false),
});

async function parentImage(client: ReturnType<typeof serviceClient>, path: string): Promise<GeneratedImage> {
  const { data, error } = await client.storage.from("pet-portraits").download(path); if (error) throw error;
  const type = data.type;
  const mimeType: GeneratedImage["mimeType"] = type === "image/jpeg" || type === "image/webp" || type === "image/svg+xml" ? type : "image/png";
  return { bytes: new Uint8Array(await data.arrayBuffer()), mimeType };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  let runId: string | null = null; let sessionId: string | null = null; let storedPath: string | null = null; const startedAt = Date.now();
  try {
    requirePost(request); const user = await authenticatedUser(request); const input = Input.parse(await request.json()); const client = serviceClient();
    const { data: pet, error: petError } = await client.from("pets").select("id,name,status,current_asset_id").eq("owner_id", user.id).single();
    if (petError) throw petError; if (pet.status === "confirmed") throw new Error("initial_editing_permanently_closed");
    const { count: ownerTurns, error: turnError } = await client.from("pet_private_threads").select("id", { count: "exact", head: true }).eq("pet_id", pet.id).eq("role", "owner");
    if (turnError) throw turnError; if ((ownerTurns ?? 0) < 5) throw new Error("five_incubation_turns_required");
    let parent: GeneratedImage | null = null; let parentId: string | null = null;
    if (!input.explore && input.base_asset_id) {
      const { data: asset, error: assetError } = await client.from("pet_visual_assets").select("id,storage_path,is_draft").eq("id", input.base_asset_id).eq("pet_id", pet.id).single();
      if (assetError || !asset.is_draft) throw new Error("base_draft_asset_invalid");
      parentId = asset.id; parent = await parentImage(client, asset.storage_path);
    }
    const { data: rawSignals, error: signalError } = await client.from("pet_style_signals").select("tendency,rationale,confidence,pet_style_feedback(feedback_kind,correction)").eq("pet_id", pet.id).eq("active", true).order("created_at", { ascending: false }).limit(20);
    if (signalError) throw signalError;
    const signals = (rawSignals ?? []).filter((signal: Record<string, any>) => signal.pet_style_feedback?.[0]?.feedback_kind !== "forgotten");
    const prompt = [
      `为一只名叫“${pet.name}”的唯一成长型异宠创作独立原创肖像。`,
      "不采用预设统一画风；从主人的相处信号自然形成材质、色彩、气质、器官与构图。禁止模仿现有 IP、受保护角色或在世艺术家的明确风格。画面只包含异宠本体，不含文字、水印和人物。",
      parent ? "这是确认前的连续修改：保留当前候选可识别的生命关系，同时按反馈调整；不是完全无关的重绘。" : input.explore ? "这是确认前重新探索的新方向，可以与旧候选明显不同。" : "这是它的第一张外观候选。",
      `主人本轮意见：${input.instruction}`,
      `相处信号：${signals.map((signal: Record<string, any>) => `${signal.tendency}（${signal.rationale}）`).join("；") || "尚少，保持开放、奇异且不过度卖萌"}`,
      "生成适合移动端展示的方形单体肖像，视觉完整、背景简洁。",
    ].join("\n");
    const promptHash = await sha256(prompt);
    const { data: generation, error: generationError } = await client.from("pet_generation_sessions").insert({ pet_id: pet.id, owner_id: user.id, status: "running", instruction: input.instruction, base_asset_id: parentId, explore: input.explore, prompt_hash: promptHash }).select("id").single();
    if (generationError) throw generationError; sessionId = generation.id;
    runId = await reserveModelRun(client, { runKind: "initial_image", dailyLimit: 20, ownerId: user.id, petId: pet.id, promptHash, model: ImageModelAdapter.modelName() });
    const generated = await new ImageModelAdapter().generateCandidate({ prompt, parent });
    storedPath = `${user.id}/${pet.id}/${crypto.randomUUID()}.${imageExtension(generated.mimeType)}`;
    const upload = await client.storage.from("pet-portraits").upload(storedPath, generated.bytes, { contentType: generated.mimeType, upsert: false });
    if (upload.error) throw upload.error;
    const latestPet = await client.from("pets").select("status").eq("id", pet.id).single();
    if (latestPet.error) throw latestPet.error; if (latestPet.data.status === "confirmed") throw new Error("pet_confirmed_while_generation_was_running");
    const { data: asset, error: assetError } = await client.from("pet_visual_assets").insert({
      pet_id: pet.id, owner_id: user.id, storage_path: storedPath, parent_asset_id: parentId,
      generation_session_id: sessionId, style_snapshot: signals, prompt_hash: promptHash, is_draft: true,
    }).select("*").single();
    if (assetError) throw assetError;
    await client.from("pets").update({ status: "drafting", updated_at: new Date().toISOString() }).eq("id", pet.id).neq("status", "confirmed");
    await client.from("pet_generation_sessions").update({ status: "succeeded", completed_at: new Date().toISOString() }).eq("id", sessionId);
    await finishModelRun(client, runId, { status: "succeeded", startedAt });
    return json(request, asset);
  } catch (reason) {
    const client = serviceClient();
    if (storedPath) await client.storage.from("pet-portraits").remove([storedPath]);
    if (sessionId) await client.from("pet_generation_sessions").update({ status: "failed", error_code: reason instanceof Error ? reason.message.slice(0, 120) : "unknown", completed_at: new Date().toISOString() }).eq("id", sessionId);
    if (runId) await finishModelRun(client, runId, { status: "failed", startedAt, errorCode: reason instanceof Error ? reason.message.slice(0, 120) : "unknown" });
    return errorResponse(request, reason);
  }
});
