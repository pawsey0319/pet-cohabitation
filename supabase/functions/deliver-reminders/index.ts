import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const role = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const secret = Deno.env.get("REMINDER_CRON_SECRET") ?? "";
    const scheduler = Boolean((role && bearer === role) || (secret && request.headers.get("x-cron-secret") === secret));
    const targetOwner = scheduler ? null : (await authenticatedUser(request)).id;
    const client = serviceClient();
    const recurring = await client.rpc("reminder_dispatch_due", { target_owner: targetOwner });
    if (recurring.error) throw recurring.error;
    const legacy = await client.rpc("deliver_legacy_reminders", { target_owner: targetOwner });
    if (legacy.error) throw legacy.error;
    // Preserve the legacy count; it never proves a phone displayed the push.
    return json(request, { delivered: legacy.data ?? 0, enqueued: recurring.data ?? 0, device_display: "unverified" });
  } catch (reason) { return errorResponse(request, reason); }
});
