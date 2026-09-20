import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";
import { TextModelAdapter } from "../_shared/modelAdapters.ts";
import { finishModelRun, reserveModelRun } from "../_shared/quota.ts";

async function probe(baseUrl: string, apiKey: string, model: string): Promise<boolean> {
  if (!baseUrl || !apiKey || !model) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = await response.json();
    return Array.isArray(body.data) && body.data.some((item: { id?: string }) => item.id === model);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const user = await authenticatedUser(request);
    const client = serviceClient();
    const mock = Deno.env.get("MODEL_MOCK_MODE") === "true";
    const textBase = Deno.env.get("TEXT_API_BASE_URL") ?? "";
    const imageBase = Deno.env.get("IMAGE_API_BASE_URL") ?? textBase;
    const textKey = Deno.env.get("TEXT_API_KEY") ?? "";
    const imageKey = Deno.env.get("IMAGE_API_KEY") ?? textKey;
    const diagnostic = { textError: null as string | null };
    const checkText = async () => {
      const startedAt = Date.now();
      let runId: string | null = null;
      try {
        runId = await reserveModelRun(client, { runKind: "text_health_check", dailyLimit: 30, ownerId: user.id, model: TextModelAdapter.modelName() });
        await new TextModelAdapter().checkStructuredOutput();
        await finishModelRun(client, runId, { status: "succeeded", startedAt });
        return true;
      } catch (reason) {
        diagnostic.textError = reason instanceof Error ? reason.message : "text_health_check_failed";
        if (runId) await finishModelRun(client, runId, { status: "failed", startedAt, errorCode: diagnostic.textError });
        return false;
      }
    };
    const [textOnline, imageOnline] = mock ? [true, true] : await Promise.all([checkText(), probe(imageBase, imageKey, Deno.env.get("IMAGE_MODEL") ?? "")]);
    const statusCode = mock ? "mock" : textOnline && imageOnline ? "online" : textOnline || imageOnline ? "partial" : "offline";
    const checkedAt = new Date().toISOString();
    await client.from("ai_provider_health").upsert({ id: true, text_online: textOnline, image_online: imageOnline, status_code: statusCode, checked_at: checkedAt, updated_at: checkedAt });
    return json(request, { text_online: textOnline, image_online: imageOnline, status_code: statusCode, checked_at: checkedAt,
      text_check: mock ? "mock" : textOnline ? "generation" : "failed",
      image_check: mock ? "mock" : imageOnline ? "catalog" : "failed",
      text_error: diagnostic.textError?.startsWith("text_model_") ? diagnostic.textError : diagnostic.textError ? "text_health_check_unavailable" : null });
  } catch (reason) {
    return errorResponse(request, reason);
  }
});
