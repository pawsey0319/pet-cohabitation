import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";
const Versioned = { request_id: z.string().uuid(), asset_id: z.string().uuid(), expected_version: z.number().int().positive() };
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), cursor: z.object({ created_at: z.string().datetime({ offset: true }), id: z.string().uuid() }).optional(), favorite_only: z.boolean().default(false), limit: z.number().int().min(1).max(50).default(24) }),
  z.object({ action: z.literal("impact"), asset_id: z.string().uuid() }),
  z.object({ action: z.literal("rename"), ...Versioned, name: z.string().trim().min(1).max(60) }),
  z.object({ action: z.literal("favorite"), ...Versioned, favorite: z.boolean() }),
  z.object({ action: z.literal("delete"), ...Versioned, settings_version: z.number().int().nonnegative() }),
]);
Deno.serve(async request => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request); const user = await authenticatedUser(request); const raw = await request.text(); if (raw.length > 8192) throw new Error("background_input_invalid");
    const input = Input.parse(JSON.parse(raw)); const client = serviceClient();
    if (input.action === "list") {
      let query = client.from("chat_background_assets").select("id,storage_path,source,prompt,created_at,name,favorite,version,content_version,parent_asset_id,parent_asset_version").eq("owner_id", user.id).is("deleted_at", null).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(input.limit + 1);
      if (input.favorite_only) query = query.eq("favorite", true);
      if (input.cursor) query = query.or(`created_at.lt.${input.cursor.created_at},and(created_at.eq.${input.cursor.created_at},id.lt.${input.cursor.id})`);
      const rows = await query; if (rows.error) throw rows.error;
      const assets = (rows.data ?? []).slice(0, input.limit); const last = assets.at(-1);
      return json(request, { assets, cursor: rows.data!.length > input.limit && last ? { created_at: last.created_at, id: last.id } : null });
    }
    if (input.action === "impact") {
      const impact = await client.rpc("background_delete_impact", { p_owner_id: user.id, p_asset_id: input.asset_id }); if (impact.error) throw impact.error;
      return json(request, impact.data);
    }
    const mutation = await client.rpc("mutate_background_asset", { p_owner_id: user.id, p_request_id: input.request_id, p_asset_id: input.asset_id, p_expected_version: input.expected_version, p_action: input.action,
      p_input: input.action === "rename" ? { name: input.name } : input.action === "favorite" ? { favorite: input.favorite } : { settings_version: input.settings_version } });
    if (mutation.error) throw mutation.error;
    if (input.action === "delete") {
      const cleanup = await client.storage.from("chat-backgrounds").remove([mutation.data.asset.storage_path]);
      // The DB tombstone already prevents subsequent reads, applies and late jobs.
      return json(request, { ...mutation.data, storage_cleanup: cleanup.error ? "pending" : "removed" });
    }
    return json(request, mutation.data);
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? "");
    const code = message.match(/background_[a-z_]+|unauthenticated/)?.[0] ?? "background_unavailable";
    return json(request, { error: code }, code === "unauthenticated" ? 401 : /conflict|changed/.test(code) ? 409 : 400);
  }
});
