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
  event_id: z.string().uuid(),
  continuity_repair: z.boolean().default(false),
  internal_auto: z.boolean().default(false),
}).strict();

type EvolutionWork = Readonly<{
  eventId: string;
  runId: string;
  ownerId: string;
  petId: string;
  parentPath: string;
  prompt: string;
  styleSnapshot: unknown;
  experienceSources: unknown;
  growthSnapshot: unknown;
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
  const client = serviceClient(); const startedAt = Date.now(); let storedPath: string | null = null;
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
      target_owner_blessing: null,
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
    const input = Input.parse(await request.json());
    const client = serviceClient();
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const internal = input.internal_auto && bearer.length > 0 && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (input.internal_auto && !internal) throw new Error("internal_evolution_authorization_required");
    const user = internal ? null : await authenticatedUser(request);
    await assertImageGenerationAllowed(client);

    let eventQuery = client.from("pet_evolution_events").select("*").eq("id", input.event_id);
    if (user) eventQuery = eventQuery.eq("owner_id", user.id);
    const eventResult = await eventQuery.single();
    if (eventResult.error) throw eventResult.error;
    const currentEvent = eventResult.data as Record<string, any>;
    const ownerId = String(currentEvent.owner_id);
    if (!internal && currentEvent.status === "queued") return json(request, { event_id: input.event_id, status: "queued", automatic: true }, 202);
    if (currentEvent.status === "running") return json(request, { event_id: input.event_id, status: "running", automatic: true }, 202);
    if (currentEvent.status === "succeeded" && !input.continuity_repair) return json(request, { event_id: input.event_id, status: "succeeded", automatic: true }, 202);

    const petResult = await client.from("pets").select("id,name,status,current_asset_id").eq("id", currentEvent.pet_id).eq("owner_id", ownerId).single();
    if (petResult.error) throw petResult.error;
    const pet = petResult.data;
    if (pet.status !== "confirmed" || !pet.current_asset_id) throw new Error("confirmed_pet_required");
    const reserved = await client.rpc("reserve_evolution_execution", { target_owner: ownerId, target_event: input.event_id, continuity_repair: input.continuity_repair });
    if (reserved.error) throw reserved.error;
    const event = reserved.data as Record<string, any>;
    const parentResult = await client.from("pet_visual_assets").select("id,storage_path").eq("id", event.parent_asset_id).eq("pet_id", pet.id).single();
    if (parentResult.error) throw parentResult.error;

    const prompt = [
      `将名为“${pet.name}”的异宠从父图推进到下一生命阶段。`,
      "必须看得出是父图中同一生命的后续阶段，而不是无关重绘。没有永久身份锚点：颜色、眼睛、轮廓、器官都允许随长期经历逐渐变化，但整体变化要有生命连续性和可追溯原因。",
      "这次变化由系统依据长期日常相处自动触发，不接受主人即时指定造型、祝福按钮或终态指令。禁止模仿现有 IP、受保护角色或在世艺术家的明确风格。",
      `成长里程碑快照：${JSON.stringify(event.growth_snapshot ?? {})}`,
      `真实经历：${JSON.stringify(event.experience_sources ?? [])}`,
      `成长札记：${JSON.stringify(event.style_snapshot ?? [])}`,
      input.continuity_repair ? "上次结果被报告与父图完全断裂。本次只修复生命连续性，沿用同一成长事件和经历，不接受任何新造型指令。" : "每个成长事件只生成一个正式结果。",
    ].join("\n");
    const promptHash = await sha256(prompt);
    let runId: string;
    try {
      runId = await createModelRun(client, { runKind: "major_evolution", ownerId, petId: pet.id, promptHash, model: ImageModelAdapter.modelName() });
    } catch (reason) {
      const errorCode = reason instanceof Error ? reason.message.slice(0, 120) : "model_run_reservation_failed";
      await client.rpc("fail_evolution_execution", { target_owner: ownerId, target_event: event.id, continuity_repair: input.continuity_repair });
      await client.from("pet_evolution_events").update({ error_code: errorCode, completed_at: new Date().toISOString() }).eq("id", event.id);
      throw reason;
    }
    runInBackground(runEvolution({ eventId: event.id, runId, ownerId, petId: pet.id, parentPath: parentResult.data.storage_path, prompt, styleSnapshot: event.style_snapshot ?? [], experienceSources: event.experience_sources ?? [], growthSnapshot: event.growth_snapshot ?? {}, continuityRepair: input.continuity_repair }));
    return json(request, { event_id: event.id, status: "queued", automatic: true }, 202);
  } catch (reason) { return errorResponse(request, reason); }
});
