import { redactAndDeleteAccount } from "../_shared/accountDeletion.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { requirePost, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  try {
    requirePost(request);
    const expectedSecret = Deno.env.get("DEMO_PURGE_SECRET")?.trim();
    if (!expectedSecret || request.headers.get("x-demo-purge-secret") !== expectedSecret) throw new Error("unauthorized");
    const client = serviceClient();
    const settings = await client.from("demo_settings").select("test_ends_at,purge_after_days").eq("id", true).single();
    if (settings.error) throw settings.error;
    if (!settings.data.test_ends_at) return json(request, { purged: 0, status: "test_end_not_configured" });
    const purgeAt = Date.parse(settings.data.test_ends_at) + Number(settings.data.purge_after_days) * 86_400_000;
    if (Date.now() < purgeAt) return json(request, { purged: 0, status: "retention_active", purge_at: new Date(purgeAt).toISOString() });

    const profiles = await client.from("profiles").select("id").eq("is_admin", false);
    if (profiles.error) throw profiles.error;
    let purged = 0;
    const failed: Array<{ user_id: string; error_code: string }> = [];
    for (const profile of profiles.data ?? []) {
      try {
        await redactAndDeleteAccount(client, profile.id);
        purged += 1;
      } catch (reason) {
        failed.push({ user_id: profile.id, error_code: reason instanceof Error ? reason.message.slice(0, 120) : "unknown" });
      }
    }
    return json(request, { purged, failed, completed_at: new Date().toISOString() });
  } catch (reason) {
    return errorResponse(request, reason);
  }
});
