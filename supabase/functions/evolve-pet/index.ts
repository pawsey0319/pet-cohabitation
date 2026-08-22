import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { sha256 } from "../_shared/hash.ts";
import { ImageModelAdapter, imageExtension, type GeneratedImage } from "../_shared/modelAdapters.ts";
import { createModelRun, finishModelRun } from "../_shared/quota.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({
  event_id: z.string().uuid().optional(),
  blessing: z.string().trim().max(1000).optional().default(""),
  continuity_repair: z.boolean().default(false),
});

async function downloadParent(client: ReturnType<typeof serviceClient>, path: string): Promise<GeneratedImage> {
  const { data, error } = await client.storage.from("pet-portraits").download(path);
  if (error) throw error;
  const type = data.type;
  const mimeType: GeneratedImage["mimeType"] = type === "image/jpeg" || type === "image/webp" || type === "image/svg+xml" ? type : "image/png";
  return { bytes: new Uint8Array(await data.arrayBuffer()), mimeType };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  let runId: string | null = null;
  let eventId: string | null = null;
  let storedPath: string | null = null;
  let ownerId: string | null = null;
  let continuityRepair = false;
  const startedAt = Date.now();
  try {
    requirePost(request);
    const user = await authenticatedUser(request);
    ownerId = user.id;
    const input = Input.parse(await request.json());
    continuityRepair = input.continuity_repair;
    const client = serviceClient();
    const { data: pet, error: petError } = await client.from("pets").select("id,name,status,current_asset_id,confirmed_at").eq("owner_id", user.id).single();
    if (petError) throw petError;
    if (pet.status !== "confirmed" || !pet.current_asset_id) throw new Error("confirmed_pet_required");

    let event: Record<string, any>;
    let parent: { id: string; storage_path: string; created_at: string };
    if (input.event_id) {
      const reserved = await client.rpc("reserve_evolution_execution", {
        target_owner: user.id,
        target_event: input.event_id,
        continuity_repair: input.continuity_repair,
      });
      if (reserved.error) throw reserved.error;
      event = reserved.data as Record<string, any>;
      eventId = event.id;
      const parentResult = await client.from("pet_visual_assets").select("id,storage_path,created_at").eq("id", event.parent_asset_id).eq("pet_id", pet.id).single();
      if (parentResult.error) throw parentResult.error;
      parent = parentResult.data;
    } else {
      if (input.continuity_repair) throw new Error("continuity_repair_requires_event");
      const currentResult = await client.from("pet_visual_assets").select("id,storage_path,created_at").eq("id", pet.current_asset_id).eq("pet_id", pet.id).single();
      if (currentResult.error) throw currentResult.error;
      parent = currentResult.data;
      const after = new Date(Math.max(Date.parse(pet.confirmed_at ?? "1970-01-01T00:00:00Z"), Date.parse(parent.created_at))).toISOString();
      const { data: experiences, error: experienceError } = await client.from("pet_experiences").select("id,category,summary,space_id,occurred_at").eq("pet_id", pet.id).gt("occurred_at", after).order("occurred_at", { ascending: false }).limit(30);
      if (experienceError) throw experienceError;
      if (!(experiences ?? []).length) throw new Error("evolution_requires_new_real_experiences");
      const { data: signals, error: signalError } = await client.from("pet_style_signals").select("tendency,rationale,confidence").eq("pet_id", pet.id).eq("active", true).order("created_at", { ascending: false }).limit(20);
      if (signalError) throw signalError;
      const created = await client.from("pet_evolution_events").insert({
        pet_id: pet.id, owner_id: user.id, parent_asset_id: parent.id,
        owner_blessing: input.blessing || null, experience_sources: experiences,
        style_snapshot: signals ?? [], status: "running",
      }).select("*").single();
      if (created.error) throw created.error;
      event = created.data;
      eventId = event.id;
    }

    const prompt = [
      `将名为“${pet.name}”的异宠从父图推进到下一生命阶段。`,
      "必须看得出是父图中同一生命的后续阶段，而不是无关重绘。没有永久身份锚点：颜色、眼睛、轮廓、器官都允许随经历逐渐变化，但整体变化要有生命连续性和可追溯原因。",
      "主人只能给祝福，不能指定终态；请由异宠结合经历自主形成结果。禁止模仿现有 IP、受保护角色或在世艺术家的明确风格。",
      `真实经历：${JSON.stringify(event.experience_sources)}`,
      `成长札记：${JSON.stringify(event.style_snapshot)}`,
      `主人祝福：${event.owner_blessing || "平安长成你自己"}`,
      input.continuity_repair ? "上次结果被报告与父图完全断裂。本次只修复生命连续性，沿用同一事件、经历与祝福，不接受任何新造型指令。" : "每个事件只生成一个正式结果。",
    ].join("\n");
    const promptHash = await sha256(prompt);
    runId = await createModelRun(client, { runKind: "major_evolution", ownerId: user.id, petId: pet.id, promptHash, model: ImageModelAdapter.modelName() });
    const generated = await new ImageModelAdapter().evolveFromParent({ prompt, parent: await downloadParent(client, parent.storage_path) });
    storedPath = `${user.id}/${pet.id}/${crypto.randomUUID()}.${imageExtension(generated.mimeType)}`;
    const upload = await client.storage.from("pet-portraits").upload(storedPath, generated.bytes, { contentType: generated.mimeType });
    if (upload.error) throw upload.error;
    const finalized = await client.rpc("finalize_evolution_asset", {
      target_owner: user.id, target_event: eventId, target_storage_path: storedPath,
      target_prompt_hash: promptHash, target_style_snapshot: event.style_snapshot,
      target_experience_sources: event.experience_sources, target_owner_blessing: event.owner_blessing,
      continuity_repair: input.continuity_repair,
    });
    if (finalized.error) throw finalized.error;
    await finishModelRun(client, runId, { status: "succeeded", startedAt });
    return json(request, finalized.data);
  } catch (reason) {
    const client = serviceClient();
    if (storedPath) await client.storage.from("pet-portraits").remove([storedPath]);
    if (eventId && ownerId) await client.rpc("fail_evolution_execution", { target_owner: ownerId, target_event: eventId, continuity_repair: continuityRepair });
    if (runId) await finishModelRun(client, runId, { status: "failed", startedAt, errorCode: reason instanceof Error ? reason.message.slice(0, 120) : "unknown" });
    return errorResponse(request, reason);
  }
});
