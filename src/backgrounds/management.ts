import { requireSupabase } from "../lib/supabase";
import { backgroundErrorMessage, type ChatBackgroundAsset } from "./types";
export type BackgroundCursor = { created_at: string; id: string };
export type BackgroundImpact = { asset_id: string; asset_version: number; settings_version: number; is_global: boolean; affected: { thread_key: string; label: string }[] };
export async function manageBackground<T>(ownerId: string, body: Record<string, unknown>): Promise<T> {
  const client = requireSupabase(); const session = await client.auth.getSession();
  if (session.data.session?.user.id !== ownerId) throw new Error("账号已切换，请重新打开背景设置。");
  const result = await client.functions.invoke("background-management", { body, headers: { Authorization: `Bearer ${session.data.session.access_token}` } });
  if (result.error) {
    let code = "network_error"; try { code = (await (result.error as unknown as { context: Response }).context.json()).error ?? code; } catch {}
    throw new Error(backgroundErrorMessage(code));
  }
  if ((await client.auth.getSession()).data.session?.user.id !== ownerId) throw new Error("账号已切换，请重新打开背景设置。");
  return result.data as T;
}
export async function listBackgrounds(ownerId: string, cursor?: BackgroundCursor, favoriteOnly = false) {
  return manageBackground<{ assets: ChatBackgroundAsset[]; cursor: BackgroundCursor | null }>(ownerId, { action: "list", favorite_only: favoriteOnly, ...(cursor ? { cursor } : {}) });
}
