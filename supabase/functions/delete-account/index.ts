import { z } from "npm:zod@4";
import { redactAndDeleteAccount } from "../_shared/accountDeletion.ts";
import { optionsResponse } from "../_shared/cors.ts";
import { errorResponse, json } from "../_shared/responses.ts";
import { anonClient, authenticatedUser, requirePost, serviceClient } from "../_shared/supabase.ts";

const Input = z.object({ password: z.string().min(8).max(128) });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  try {
    requirePost(request);
    const user = await authenticatedUser(request);
    const input = Input.parse(await request.json());
    if (!user.email) throw new Error("account_email_missing");
    const verified = await anonClient().auth.signInWithPassword({ email: user.email, password: input.password });
    if (verified.error || verified.data.user?.id !== user.id) throw new Error("password_verification_failed");

    const redactedAt = await redactAndDeleteAccount(serviceClient(), user.id);
    return json(request, { deleted: true, redacted_at: redactedAt });
  } catch (reason) {
    return errorResponse(request, reason);
  }
});
