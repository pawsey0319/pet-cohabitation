import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { requirePost, serviceClient } from "../_shared/supabase.ts";
import { dispatchNotifications, pollNotificationReceipts } from "./worker.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const role = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const secret = Deno.env.get("PUSH_CRON_SECRET") ?? "";
    if (!((role && bearer === role) || (secret && request.headers.get("x-cron-secret") === secret))) throw new Error("forbidden_push_dispatch");
    const client = serviceClient();
    const options = { accessToken: Deno.env.get("EXPO_ACCESS_TOKEN") };
    const receipts = await pollNotificationReceipts(client, options);
    const sending = await dispatchNotifications(client, options);
    return json(request, { ...sending, receipts, device_display: "unverified" });
  } catch (reason) { return errorResponse(request, reason); }
});
