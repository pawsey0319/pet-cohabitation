import { corsHeaders } from "./cors.ts";

export function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function errorResponse(request: Request, reason: unknown, fallbackStatus = 400): Response {
  const message = reason instanceof Error ? reason.message : "unknown_error";
  const status = /unauthenticated|invalid token/i.test(message) ? 401
    : /forbidden|not_space_member|admin_required|service_role/i.test(message) ? 403
    : /quota|limit|closed|confirmed|already/i.test(message) ? 409
    : fallbackStatus;
  return json(request, { error: message }, status);
}
