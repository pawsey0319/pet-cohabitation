import { z } from "npm:zod@4";
import { optionsResponse } from "../_shared/cors.ts";
import { assertRegistrationAllowed } from "../_shared/demoSettings.ts";
import { sha256 } from "../_shared/hash.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { anonClient, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({
  inviteCode: z.string().trim().min(6).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  nickname: z.string().trim().min(1).max(30),
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const input = Input.parse(await request.json());
    const service = serviceClient();
    await assertRegistrationAllowed(service);
    const codeHash = await sha256(input.inviteCode.toUpperCase());
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email: input.email.toLowerCase(), password: input.password, email_confirm: true,
      user_metadata: { nickname: input.nickname },
    });
    if (createError || !created.user) throw createError ?? new Error("auth_user_creation_failed");
    const { error: claimError } = await service.rpc("claim_signup_invite", {
      invite_code_hash: codeHash, new_user_id: created.user.id, new_email: input.email, new_nickname: input.nickname,
    });
    if (claimError) {
      await service.auth.admin.deleteUser(created.user.id);
      throw claimError;
    }
    const { data: session, error: signInError } = await anonClient().auth.signInWithPassword({ email: input.email, password: input.password });
    if (signInError || !session.session) throw signInError ?? new Error("session_creation_failed");
    return json(request, { access_token: session.session.access_token, refresh_token: session.session.refresh_token });
  } catch (reason) {
    return errorResponse(request, reason);
  }
});
