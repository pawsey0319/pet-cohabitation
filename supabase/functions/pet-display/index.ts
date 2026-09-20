import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { json } from "../_shared/responses.ts";
import { authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), pet_id: z.string().uuid() }),
  z.object({ action: z.literal("request"), pet_id: z.string().uuid(), request_id: z.string().uuid(), expected_version: z.number().int().nonnegative() }),
  z.object({ action: z.literal("set"), pet_id: z.string().uuid(), request_id: z.string().uuid(), expected_version: z.number().int().nonnegative(), use_transparent: z.boolean() }),
  z.object({ action: z.literal("approve"), pet_id: z.string().uuid(), request_id: z.string().uuid(), job_id: z.string().uuid(), source_asset_id: z.string().uuid(), expected_version: z.number().int().nonnegative() }),
]);
Deno.serve(async request => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request); const user = await authenticatedUser(request); const raw = await request.text();
    if (raw.length > 8192) throw new Error("pet_display_input_invalid"); const input = Input.parse(JSON.parse(raw)); const client = serviceClient();
    const pet = await client.from("pets").select("id,current_asset_id").eq("id", input.pet_id).eq("owner_id", user.id).single(); if (pet.error) return json(request, { error: "pet_display_forbidden" }, 403);
    const control = await client.from("chat_background_owner_controls").select("deleting").eq("owner_id", user.id).maybeSingle(); if (control.error) throw control.error;
    if (control.data?.deleting) return json(request, { error: "pet_display_forbidden" }, 403);
    if (input.action === "request") {
      const job = await client.rpc("request_pet_transparent", { p_owner_id: user.id, p_pet_id: input.pet_id, p_request_id: input.request_id, p_expected_version: input.expected_version }); if (job.error) throw job.error;
      return json(request, { job: { id: job.data.id, status: job.data.status, error_code: job.data.error_code } }, 202);
    }
    if (input.action === "set") {
      const changed = await client.rpc("set_pet_display", { p_owner_id: user.id, p_pet_id: input.pet_id, p_request_id: input.request_id, p_expected_version: input.expected_version, p_use_transparent: input.use_transparent }); if (changed.error) throw changed.error;
      return json(request, { preference: changed.data });
    }
    if (input.action === "approve") {
      const approved = await client.rpc("approve_pet_transparent", { p_owner_id: user.id, p_pet_id: input.pet_id, p_request_id: input.request_id, p_job_id: input.job_id, p_source_asset_id: input.source_asset_id, p_expected_version: input.expected_version }); if (approved.error) throw approved.error;
      return json(request, { preference: approved.data });
    }
    const pref = await client.from("pet_display_preferences").select("version,use_transparent,approved_job_id,approved_source_asset_id,approved_display_version,approved_at").eq("pet_id", input.pet_id).eq("owner_id", user.id).maybeSingle(); if (pref.error) throw pref.error;
    const preference = pref.data ?? { version: 0, use_transparent: true };
    const job = await client.from("pet_transparent_jobs").select("id,status,error_code,output_path").eq("pet_id", input.pet_id).eq("owner_id", user.id).eq("source_asset_id", pet.data.current_asset_id).eq("expected_display_version", preference.version).order("created_at", { ascending: false }).limit(1).maybeSingle(); if (job.error) throw job.error;
    let url: string | null = null; let candidateUrl: string | null = null;
    if (preference.use_transparent && job.data?.status === "succeeded" && job.data.output_path) {
      const signed = await client.storage.from("pet-transparent").createSignedUrl(job.data.output_path, 300); if (signed.error) throw signed.error; candidateUrl = signed.data.signedUrl;
      // Existing clients only consume url. A completed worker result is a
      // private preview until the owner approves this exact source/job/version.
    }
    if (candidateUrl) {
      // Signing crosses a network boundary. Revalidate immediately before
      // returning URLs so a restore/source change/deletion during signing
      // does not publish the earlier choice as the current main portrait.
      const [latestPet, latestPref, latestControl] = await Promise.all([
        client.from("pets").select("id,current_asset_id").eq("id", input.pet_id).eq("owner_id", user.id).maybeSingle(),
        client.from("pet_display_preferences").select("version,use_transparent,approved_job_id,approved_source_asset_id,approved_display_version,approved_at").eq("pet_id", input.pet_id).eq("owner_id", user.id).maybeSingle(),
        client.from("chat_background_owner_controls").select("deleting").eq("owner_id", user.id).maybeSingle(),
      ]);
      if (latestPet.error || latestPref.error || latestControl.error) throw new Error("pet_display_unavailable");
      if (!latestPet.data || latestControl.data?.deleting) return json(request, { error: "pet_display_forbidden" }, 403);
      const latestPreference = latestPref.data ?? { version: 0, use_transparent: true };
      if (latestPet.data.current_asset_id !== pet.data.current_asset_id || latestPreference.version !== preference.version || !latestPreference.use_transparent) {
        return json(request, { preference: latestPreference, source_asset_id: latestPet.data.current_asset_id, url: null, candidate_url: null, job: null });
      }
      // Approval itself does not advance version. Use the latest exact receipt
      // when deciding whether this already-signed candidate may be displayed.
      url = latestPref.data?.approved_job_id === job.data?.id && latestPref.data?.approved_source_asset_id === pet.data.current_asset_id && latestPref.data?.approved_display_version === preference.version && latestPref.data?.approved_at ? candidateUrl : null;
      return json(request, { preference: latestPreference, source_asset_id: latestPet.data.current_asset_id, url, candidate_url: candidateUrl, job: job.data ? { id: job.data.id, status: job.data.status, error_code: job.data.error_code } : null });
    }
    return json(request, { preference, source_asset_id: pet.data.current_asset_id, url, candidate_url: candidateUrl, job: job.data ? { id: job.data.id, status: job.data.status, error_code: job.data.error_code } : null });
  } catch (reason) {
    const raw = reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? "");
    const code = raw.match(/pet_display_[a-z_]+|unauthenticated/)?.[0] ?? "pet_display_unavailable";
    return json(request, { error: code }, code === "unauthenticated" ? 401 : /conflict/.test(code) ? 409 : 400);
  }
});
