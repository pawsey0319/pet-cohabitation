import { z } from "npm:zod@4";
import { runInBackground } from "../_shared/background.ts";
import { optionsResponse } from "../_shared/cors.ts";
import { assertImageGenerationAllowed } from "../_shared/demoSettings.ts";
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

type EvolutionWork = Readonly<{
  eventId: string;
  runId: string;
  ownerId: string;
  petId: string;
  parentPath: string;
  prompt: string;
  styleSnapshot: unknown;
  experienceSources: unknown;
  ownerBlessing: string | null;
  continuityRepair: boolean;
}>;

async function downloadParent(client: ReturnType<typeof serviceClient>, path: string): Promise<GeneratedImage> {
  const { data, error } = await client.storage.from("pet-portraits").download(path);
  if (error) throw error;
  const type = data.type;
  const mimeType: GeneratedImage["mimeType"] = type === "image/jpeg" || type === "image/webp" || type === "image/svg+xml" ? type : "image/png";
  return { bytes: new Uint8Array(await data.arrayBuffer()), mimeType };
}

async function runEvolution(work: EvolutionWork): Promise<void> {
  const client = serviceClient();
  const startedAt = Date.now();
  let storedPath: string | null = null;
  try {
    await client.from("pet_evolution_events").update({ status: "running", prompt_hash: await sha256(work.prompt), error_code: null, completed_at: null }).eq("id", work.eventId);
    const generated = await new ImageModelAdapter().evolveFromParent({ prompt: work.prompt, parent: await downloadParent(client, work.parentPath) });
    storedPath = `${work.ownerId}/${work.petId}/${crypto.randomUUID()}.${imageExtension(generated.mimeType)}`;
    const upload = await client.storage.from("pet-portraits").upload(storedPath, generated.bytes, { contentType: generated.mimeType });
    if (upload.error) throw upload.error;
    const finalized = await client.rpc("finalize_evolution_asset", {
      target_owner: work.ownerId,
      target_event: work.eventId,
      target_storage_path: storedPath,
      target_prompt_hash: await sha256(work.prompt),
      target_style_snapshot: work.styleSnapshot,
      target_experience_sources: work.experienceSources,
      target_owner_blessing: work.ownerBlessing,
      continuity_repair: work.continuityRepair,
    });
    if (finalized.error) throw finalized.error;
    await finishModelRun(client, work.runId, { status: "succeeded", startedAt });
  } catch (reason) {
    if (storedPath) await client.storage.from("pet-portraits").remove([storedPath]);
    const errorCode = reason instanceof Error ? reason.message.slice(0, 120) : "unknown";
    await client.rpc("fail_evolution_execution", { target_owner: work.ownerId, target_event: work.eventId, continuity_repair: work.continuityRepair });
    await client.from("pet_evolution_events").update({ error_code: errorCode, completed_at: new Date().toISOString() }).eq("id", work.eventId);
    await finishModelRun(client, work.runId, { status: "failed", startedAt, errorCode });
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const user = await authenticatedUser(request);
    const input = Input.parse(await request.json());
    const client = serviceClient();
    await assertImageGenerationAllowed(client);
    const petResult = await client.from("pets").select("id,name,status,current_asset_id,confirmed_at").eq("owner_id", user.id).single();
    if (petResult.error) throw petResult.error;
    const pet = petResult.data;
    if (pet.status !== "confirmed" || !pet.current_asset_id) throw new Error("confirmed_pet_required");

    let event: Record<string, any>;
    let parent: { id: string; storage_path: string; created_at: string };
    if (input.event_id) {
      const currentEvent = await client.from("pet_evolution_events").select("status,official_asset_id,continuity_repair_used").eq("id", input.event_id).eq("owner_id", user.id).single();
      if (currentEvent.error) throw currentEvent.error;
      if (currentEvent.data.status === "running" || currentEvent.data.status === "queued") return json(request, { event_id: input.event_id, status: currentEvent.data.status }, 202);
      const reserved = await client.rpc("reserve_evolution_execution", { target_owner: user.id, target_event: input.event_id, continuity_repair: input.continuity_repair });
      if (reserved.error) throw reserved.error;
      event = reserved.data as Record<string, any>;
      const parentResult = await client.from("pet_visual_assets").select("id,storage_path,created_at").eq("id", event.parent_asset_id).eq("pet_id", pet.id).single();
      if (parentResult.error) throw parentResult.error;
      parent = parentResult.data;
    } else {
      if (input.continuity_repair) throw new Error("continuity_repair_requires_event");
      const existing = await client.from("pet_evolution_events").select("id,status").eq("pet_id", pet.id).eq("parent_asset_id", pet.current_asset_id).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) return json(request, { event_id: existing.data.id, status: existing.data.status }, 202);
      const currentResult = await client.from("pet_visual_assets").select("id,storage_path,created_at").eq("id", pet.current_asset_id).eq("pet_id", pet.id).single();
      if (currentResult.error) throw currentResult.error;
      parent = currentResult.data;
      const after = new Date(Math.max(Date.parse(pet.confirmed_at ?? "1970-01-01T00:00:00Z"), Date.parse(parent.created_at))).toISOString();
      const experienceResult = await client.from("pet_experiences").select("id,category,summary,space_id,occurred_at").eq("pet_id", pet.id).gt("occurred_at", after).order("occurred_at", { ascending: false }).limit(30);
      if (experienceResult.error) throw experienceResult.error;
      if (!(experienceResult.data ?? []).length) throw new Error("evolution_requires_new_real_experiences");
      const signalResult = await client.from("pet_style_signals").select("tendency,rationale,confidence").eq("pet_id", pet.id).eq("active", true).order("created_at", { ascending: false }).limit(20);
      if (signalResult.error) throw signalResult.error;
      const created = await client.from("pet_evolution_events").insert({ pet_id: pet.id, owner_id: user.id, parent_asset_id: parent.id, owner_blessing: input.blessing || null, experience_sources: experienceResult.data, style_snapshot: signalResult.data ?? [], status: "queued" }).select("*").single();
      if (created.error?.code === "23505") {
        const raced = await client.from("pet_evolution_events").select("id,status").eq("pet_id", pet.id).eq("parent_asset_id", parent.id).single();
        if (raced.error) throw raced.error;
        return json(request, { event_id: raced.data.id, status: raced.data.status }, 202);
      }
      if (created.error) throw created.error;
      event = created.data;
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
    let runId: string;
    try {
      runId = await createModelRun(client, { runKind: "major_evolution", ownerId: user.id, petId: pet.id, promptHash, model: ImageModelAdapter.modelName() });
    } catch (reason) {
      const errorCode = reason instanceof Error ? reason.message.slice(0, 120) : "model_run_reservation_failed";
      if (input.event_id) {
        await client.rpc("fail_evolution_execution", { target_owner: user.id, target_event: event.id, continuity_repair: input.continuity_repair });
        await client.from("pet_evolution_events").update({ error_code: errorCode, completed_at: new Date().toISOString() }).eq("id", event.id);
      } else {
        await client.from("pet_evolution_events").update({ status: "failed", failed_attempts: 1, error_code: errorCode, completed_at: new Date().toISOString() }).eq("id", event.id);
      }
      throw reason;
    }
    runInBackground(runEvolution({ eventId: event.id, runId, ownerId: user.id, petId: pet.id, parentPath: parent.storage_path, prompt, styleSnapshot: event.style_snapshot, experienceSources: event.experience_sources, ownerBlessing: event.owner_blessing, continuityRepair: input.continuity_repair }));
    return json(request, { event_id: event.id, status: "queued" }, 202);
  } catch (reason) {
    return errorResponse(request, reason);
  }
});
