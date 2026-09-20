import { readAccountPages } from "./dataPagination.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
export async function exportAvatarData(client: SupabaseClient, ownerId: string) {
  const page = (table: string) => readAccountPages(client,table,ownerId,{key:table === "pet_display_preferences" ? "pet_id" : table === "personal_image_design_claims" || table === "avatar_mutations" || table === "pet_display_mutations" ? "request_id" : "id"});
  const tables = ["avatar_assets", "avatar_generations", "avatar_mutations", "personal_image_design_claims", "pet_display_preferences", "pet_transparent_jobs", "pet_display_mutations"];
  const values = await Promise.all(tables.map(table => table === "personal_image_design_claims"
    ? Promise.all(["avatar","background"].map(kind => readAccountPages(client,table,ownerId,{key:"request_id",equals:{kind}}))).then(groups => groups.flat()) : page(table)));
  const binding = await client.from("avatar_bindings").select("*").eq("target_kind", "profile").eq("target_id", ownerId); if (binding.error) throw binding.error;
  return { ...Object.fromEntries(tables.map((table, index) => [table, values[index]])), avatar_bindings: binding.data };
}
export async function deleteAvatarData(client: SupabaseClient, ownerId: string): Promise<void> {
  const blocked = await client.rpc("block_avatar_owner", { p_owner_id: ownerId }); if (blocked.error) throw blocked.error;
  const cancelled = await client.from("pet_transparent_jobs").update({ status: "cancelled", error_code: "account_deleted", completed_at: new Date().toISOString() }).eq("owner_id", ownerId).in("status", ["queued", "running"]); if (cancelled.error) throw cancelled.error;
  const deadline = Date.now() + 20_000;
  for (;;) {
    const now = new Date().toISOString();
    for (const table of ["avatar_generations", "pet_transparent_jobs"]) {
      const expired = await client.from(table).update({ status: "failed", error_code: "account_deleted", completed_at: now }).eq("owner_id", ownerId).in("status", ["running", "uploading"]).lt("lease_until", now); if (expired.error) throw expired.error;
    }
    const [avatar, pet] = await Promise.all([
      client.from("avatar_generations").select("id").eq("owner_id", ownerId).eq("status", "running").eq("upload_started", true).limit(1),
      client.from("pet_transparent_jobs").select("id").eq("owner_id", ownerId).eq("status", "uploading").limit(1),
    ]);
    if (avatar.error) throw avatar.error; if (pet.error) throw pet.error;
    if (!avatar.data?.length && !pet.data?.length) break;
    if (Date.now() >= deadline) throw new Error("头像或异宠图片正在保存，请稍后重试注销。");
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  for (const bucket of ["avatars", "pet-transparent"]) for (;;) {
    const listed = await client.storage.from(bucket).list(ownerId, { limit: 100 }); if (listed.error) throw listed.error;
    const paths = (listed.data ?? []).filter(row => row.id).map(row => `${ownerId}/${row.name}`); if (!paths.length) break;
    const removed = await client.storage.from(bucket).remove(paths); if (removed.error) throw removed.error;
  }
}
