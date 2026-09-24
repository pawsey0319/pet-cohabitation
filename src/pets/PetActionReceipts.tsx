import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { usePetSectionFocusEffect } from "./PetSectionScope";
import { useSession } from "../auth/SessionProvider";
import { requireSupabase } from "../lib/supabase";
import { useAppTheme } from "../theme/ThemeProvider";
import { AppButton } from "../ui/common";
import { createRequestId } from "../lib/uuid";
import type { PetActionReceipt } from "../../supabase/functions/_shared/petCapabilities";

export function PetActionReceipts({ sourceMessageId }: { sourceMessageId: string }) {
  const { profile, isLocalDemo } = useSession(); const { theme } = useAppTheme(); const router = useRouter();
  const [rows, setRows] = useState<PetActionReceipt[]>([]);
  usePetSectionFocusEffect(useCallback(() => {
    if (!profile || isLocalDemo) return;
    let active = true; const client = requireSupabase();
    const load = async () => {
      const result = await client.from("pet_action_receipts").select("*").eq("owner_id", profile.id).eq("source_kind", "private").eq("source_id", sourceMessageId).order("step");
      if (active && !result.error) setRows(result.data ?? []);
    };
    void load();
    const channel = client.channel(`action-receipts:${sourceMessageId}:${createRequestId()}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "pet_action_receipts", filter: `source_id=eq.${sourceMessageId}` }, () => void load()).subscribe();
    return () => { active = false; void client.removeChannel(channel); };
  }, [sourceMessageId, profile?.id, isLocalDemo]));
  return <>{rows.map(row => <View key={row.id} style={{ padding: 12, borderWidth: 1, borderColor: theme.line, borderRadius: theme.radius, gap: 8 }}>
    <Text style={{ color: theme.text }}>{row.summary}</Text>
    {Object.entries(row.result ?? {}).filter(([key]) => ["item", "items", "series", "memories", "matches", "assets"].includes(key)).map(([key, value]) => <Text key={key} selectable style={{ color: theme.muted }}>{formatActionResult(value)}</Text>)}
    {row.route ? <AppButton label={row.status === "needs_confirmation" ? "打开操作入口" : row.status === "not_granted" ? "查看授权" : "查看详情"} variant="quiet" onPress={() => router.push(row.route as Href)} /> : null}
  </View>)}</>;
}
export function formatActionResult(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatActionResult).filter(Boolean).join("\n") || "当前没有相关记录。";
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  return [row.title ?? row.content ?? row.name, row.status ? ({ draft: "草稿", pending: "待处理", not_started: "未开始", in_progress: "进行中", completed: "已完成", cancelled: "已取消", active: "有效" }[String(row.status)] ?? row.status) : null].filter(Boolean).join(" · ");
}
