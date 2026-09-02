import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

async function probe(baseUrl: string, apiKey: string): Promise<boolean> {
  if (!baseUrl || !apiKey) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
    return response.ok;
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
    await authenticatedUser(request);
    const mock = (Deno.env.get("MODEL_MOCK_MODE") ?? "true").toLowerCase() === "true";
    const textBase = Deno.env.get("TEXT_API_BASE_URL") ?? "";
    const imageBase = Deno.env.get("IMAGE_API_BASE_URL") ?? textBase;
    const textKey = Deno.env.get("TEXT_API_KEY") ?? "";
    const imageKey = Deno.env.get("IMAGE_API_KEY") ?? textKey;
    const [textOnline, imageOnline] = mock ? [true, true] : await Promise.all([probe(textBase, textKey), probe(imageBase, imageKey)]);
    const statusCode = mock ? "mock" : textOnline && imageOnline ? "online" : textOnline || imageOnline ? "partial" : "offline";
    const checkedAt = new Date().toISOString();
    await serviceClient().from("ai_provider_health").upsert({ id: true, text_online: textOnline, image_online: imageOnline, status_code: statusCode, checked_at: checkedAt, updated_at: checkedAt });
    return json(request, { text_online: textOnline, image_online: imageOnline, status_code: statusCode, checked_at: checkedAt });
  } catch (reason) {
    return errorResponse(request, reason);
  }
});
