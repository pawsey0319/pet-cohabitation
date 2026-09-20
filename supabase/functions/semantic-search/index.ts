import { optionsResponse } from "../_shared/cors.ts";
import { json, errorResponse } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";
import { reserveModelRun, finishModelRun } from "../_shared/quota.ts";
import { TextModelAdapter } from "../_shared/modelAdapters.ts";
import { SemanticSearchInput, searchSemantically } from "../_shared/semanticSearch.ts";

Deno.serve(async request => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  const startedAt = Date.now(); let runId: string | null = null;
  try {
    requirePost(request); const user = await authenticatedUser(request); const input = SemanticSearchInput.parse(await request.json()); const client = serviceClient();
    runId = await reserveModelRun(client, { runKind: "semantic_search", ownerId: user.id, dailyLimit: 100, model: TextModelAdapter.modelName() });
    const result = await searchSemantically(client, user.id, input);
    await finishModelRun(client, runId, { status: "succeeded", startedAt });
    return json(request, result);
  } catch (reason) {
    const invalid = reason instanceof Error && reason.name === "ZodError";
    const code = invalid ? "invalid_search_input" : reason instanceof Error && /^[a-z_0-9]+$/.test(reason.message) ? reason.message : "semantic_search_unavailable";
    if (runId) await finishModelRun(serviceClient(), runId, { status: "failed", startedAt, errorCode: code });
    return errorResponse(request, new Error(code), code === "unauthenticated" ? 401 : invalid ? 400 : 503);
  }
});
