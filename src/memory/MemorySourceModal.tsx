import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text } from "react-native";
import { requireSupabase } from "../lib/supabase";
import { KeyboardScreen } from "../components/KeyboardLayout";
import { useAppTheme } from "../theme/ThemeProvider";
import { AppButton, Surface } from "../ui/common";
export type MemorySourceTarget = { kind: "message" | "memory"; id: string };
type Source = { title: string; content: string; date: string; original?: string };
/** Read-only source lookup: original chat remains readable without re-extraction. */
export async function readMemorySource(ownerId: string, petId: string, target: MemorySourceTarget): Promise<Source | null> {
  if (!/^[0-9a-f-]{36}$/i.test(target.id)) return null;
  const client = requireSupabase();
  if (target.kind === "message") {
    const result = await client.from("pet_private_threads").select("content,created_at,role").eq("id", target.id).eq("owner_id", ownerId).eq("pet_id", petId).maybeSingle();
    if (result.error) throw result.error;
    return result.data ? { title: result.data.role === "owner" ? "你的原话" : "异宠的原回复", content: result.data.content, date: result.data.created_at } : null;
  }
  const tables = [
    { table: "pet_personal_memories", fields: "content,updated_at,source_message_id", state: false },
    { table: "pet_memory_evidence", fields: "object,quote,occurred_at,source_message_id", state: true },
    { table: "pet_life_facts", fields: "label,quote,source_date,source_message_id", state: true },
  ];
  for (const table of tables) {
    let query = client.from(table.table).select(table.fields).eq("id", target.id).eq("owner_id", ownerId).eq("pet_id", petId);
    if (table.state) query = query.eq("state", "active");
    const result = await query.maybeSingle(); if (result.error) throw result.error;
    const row = result.data as unknown as Record<string, string> | null;
    if (!row) continue;
    let original: string | undefined;
    if (row.source_message_id) {
      const excluded = await client.from("pet_private_context_exclusions").select("message_id").eq("owner_id", ownerId).eq("message_id", row.source_message_id).maybeSingle();
      if (excluded.error) throw excluded.error; if (excluded.data) return null;
      original = (await readMemorySource(ownerId, petId, { kind: "message", id: row.source_message_id }))?.content;
    }
    return { title: row.label ?? row.object ?? "主动保存的记忆", content: row.quote ?? row.content, date: row.source_date ?? row.occurred_at ?? row.updated_at, original };
  }
  return null;
}
export function MemorySourceModal({ ownerId, petId, target, onClose }: { ownerId: string; petId: string; target: MemorySourceTarget | null; onClose(): void }) {
  const { theme } = useAppTheme(); const [value, setValue] = useState<Source | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  useEffect(() => { let active = true; setValue(null); setError(""); setLoading(!!target); if (target) void readMemorySource(ownerId, petId, target).then(result => { if (active) setValue(result); }).catch(() => { if (active) setError("原文暂时无法读取，请联网后重试。"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [ownerId, petId, target]);
  return <Modal visible={!!target} transparent animationType="fade" onRequestClose={onClose}><KeyboardScreen style={{ flex: 1, justifyContent: "center", padding: 20, backgroundColor: theme.overlay }}><Surface style={{ maxHeight: "85%", gap: 12 }}>
    <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>{value?.title ?? "查看来源"}</Text>
    {loading ? <ActivityIndicator /> : <ScrollView><Text selectable style={{ color: theme.text, lineHeight: 24 }}>{value?.content ?? (error || "这条内容已删除、已停用，或当前账号无权查看。")}</Text>{value ? <Text style={{ color: theme.muted, marginTop: 12 }}>{new Date(value.date).toLocaleString("zh-CN")}</Text> : null}{value?.original && value.original !== value.content ? <Text selectable style={{ color: theme.text, marginTop: 16, lineHeight: 24 }}>原话：{value.original}</Text> : null}</ScrollView>}
    <AppButton label="返回" variant="quiet" onPress={onClose} />
  </Surface></KeyboardScreen></Modal>;
}
