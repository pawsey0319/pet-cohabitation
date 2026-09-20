import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    await authenticatedUser(request);
    const command = await request.json();
    if (!command || typeof command !== "object" || JSON.stringify(command).length > 12000) throw new Error("invalid_reminder_command");
    // The caller JWT binds ownership, immutable requests, version and writes.
    const token = request.headers.get("authorization")!.replace(/^Bearer\s+/i, "");
    const result = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/manage_reminder`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ command }), signal: AbortSignal.timeout(20000),
    });
    const body = await result.json();
    if (!result.ok) {
      const code = String(body.message ?? "reminder_failed");
      return json(request, { error: code }, code.includes("conflict") || code.includes("mismatch") ? 409 : code.includes("forbidden") ? 403 : 400);
    }
    return json(request, body);
  } catch (reason) { return errorResponse(request, reason); }
});
