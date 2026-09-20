import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
/** A unique immutable key prevents inserts/deletes shifting subsequent pages. */
export async function readAccountPages(client: SupabaseClient, table: string, owner: string, options: { ownerColumn?: string; key?: string; select?: string; equals?: Record<string, string> } = {}): Promise<Record<string, any>[]> {
  const key = options.key ?? "id", rows: Record<string, any>[] = []; let after: string | null = null;
  for (;;) {
    let query = client.from(table).select(options.select ?? "*").eq(options.ownerColumn ?? "owner_id", owner).order(key).limit(500);
    for (const [column,value] of Object.entries(options.equals ?? {})) query = query.eq(column,value);
    if (after !== null) query = query.gt(key, after);
    const result = await query; if (result.error) throw result.error;
    const page = (result.data ?? []) as unknown as Record<string, any>[]; rows.push(...page);
    if (page.length < 500) return rows;
    const cursor = page.at(-1)?.[key]; if (typeof cursor !== "string" || cursor === after) throw new Error("account_export_cursor_invalid"); after = cursor;
  }
}
/** Recursive bucket prefix cleanup includes abandoned uploads, without offset deletion skips. */
export async function removeStoragePrefix(client: SupabaseClient, bucket: string, prefix: string): Promise<void> {
  for (;;) {
    const result = await client.storage.from(bucket).list(prefix, { limit: 100, sortBy: { column: "name", order: "asc" } }); if (result.error) throw result.error;
    const rows = result.data ?? []; if (!rows.length) return;
    const paths = rows.filter(row => row.id).map(row => `${prefix}/${row.name}`);
    if (paths.length) { const removed = await client.storage.from(bucket).remove(paths); if (removed.error) throw removed.error; }
    for (const folder of rows.filter(row => !row.id)) await removeStoragePrefix(client, bucket, `${prefix}/${folder.name}`);
  }
}
