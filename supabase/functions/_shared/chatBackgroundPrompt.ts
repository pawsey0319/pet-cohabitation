export function buildChatBackgroundPrompt(description: string): string {
  return `Create an elegant wallpaper for an adult private chat app. User's visual brief: ${description.trim()}\nComposition: atmospheric, calm, restrained detail, generous quiet space in the middle for readable message bubbles. The square image will be center-cropped on a portrait phone: keep essential visual motifs within the center third. No text, letters, UI, chat bubbles, logos, frames or watermarks. This is a background artwork, not an app screenshot. Follow the user's color and subject preferences with a polished, natural finish.`;
}

export function validateBackgroundImage(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" {
  if (bytes.byteLength < 16 || bytes.byteLength > 8 * 1024 * 1024) throw new Error("background_invalid_image");
  if ([137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)) return "image/png";
  if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP') return "image/webp";
  throw new Error("background_invalid_image");
}

export function backgroundErrorCode(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : typeof reason==='object' && reason && 'message' in reason ? String(reason.message) : '';
  // Provider bodies, URLs, SQL details and credentials never reach the app or job table.
  const known = message.match(/(?:background_(?:generation_timeout|generation_busy|daily_limit|global_quota|request_conflict|prompt_invalid|invalid_image|mock_disabled|not_found)|image_(?:generation_paused|model_(?:timeout|network_error|missing_output|provider_session_required|content_blocked|rate_limited|http_\d{3}))|demo_test_ended|unauthenticated|method_not_allowed)/);
  if (known) return known[0];
  if (/missing|environment|MODEL|API_KEY|API_BASE/i.test(message)) return "background_not_configured";
  return "background_generation_failed";
}
