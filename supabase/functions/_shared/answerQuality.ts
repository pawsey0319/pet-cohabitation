export type DigestMessage = Readonly<{
  id: string;
  actor: string;
  content: string;
  createdAt: string;
}>;

export type SpaceDigest = Readonly<{
  topics: readonly string[];
  decisions: readonly string[];
  todos: readonly string[];
  schedules: readonly string[];
  pending: readonly string[];
  covered_from: string;
  covered_to: string;
  message_count: number;
  source_message_ids: readonly string[];
}>;

function digestValueText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(digestValueText).filter(Boolean).join("；");
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const preferredKeys = ["text", "summary", "topic", "decision", "todo", "schedule", "pending", "content", "title", "action", "description", "detail", "key_points"];
  const preferred = preferredKeys.map((key) => digestValueText(record[key])).filter(Boolean);
  if (preferred.length) return [...new Set(preferred)].join("；");
  return Object.entries(record)
    .filter(([key]) => !/^(id|message_id|source_message_ids?)$/i.test(key))
    .map(([, nested]) => digestValueText(nested)).filter(Boolean).join("；");
}

export function normalizeDigestStringList(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map(digestValueText).filter(Boolean);
}

export function chunkDigestMessages(
  messages: readonly DigestMessage[],
  limits: Readonly<{ maxMessages: number; maxCharacters: number }> = { maxMessages: 80, maxCharacters: 40_000 },
): readonly (readonly DigestMessage[])[] {
  const chunks: DigestMessage[][] = [];
  let current: DigestMessage[] = [];
  let characters = 0;
  for (const message of messages) {
    const nextCharacters = message.actor.length + message.content.length + 32;
    if (current.length && (current.length >= limits.maxMessages || characters + nextCharacters > limits.maxCharacters)) {
      chunks.push(current); current = []; characters = 0;
    }
    current.push(message); characters += nextCharacters;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function section(label: string, values: readonly string[]): string {
  return values.length ? `${label}\n${values.map((value) => `- ${value}`).join("\n")}` : "";
}

export function formatSpaceDigest(digest: SpaceDigest): string {
  const details = [
    section("主要话题", digest.topics),
    section("已确认", digest.decisions),
    section("待办", digest.todos),
    section("时间安排", digest.schedules),
    section("待确认", digest.pending),
  ].filter(Boolean);
  const coverage = `已覆盖 ${digest.message_count} 条消息 · ${digest.covered_from.slice(0, 16).replace("T", " ")} 至 ${digest.covered_to.slice(0, 16).replace("T", " ")}`;
  return [...details, coverage].join("\n\n");
}

export function isUninformativeRecall(content: string, hadRecallMessages: boolean): boolean {
  if (!hadRecallMessages) return false;
  const normalized = content.replace(/\s+/g, "").trim();
  if (normalized.length < 12) return true;
  return /(?:先|再)?(?:凑近|观察|看看|查查|整理一下).{0,12}(?:再|之后|稍后)(?:告诉|回复|汇报)|我(?:还)?需要(?:先)?看看|等我(?:先)?查/.test(normalized);
}

export function fallbackRecallAnswer(messages: readonly Readonly<{ actor: string; content: string }>[]): string {
  if (!messages.length) return "我查过你当前仍有权限查看的群聊，这次没有找到相关消息。";
  const selected = messages.slice(-8);
  return [
    "我查到了这些直接相关的群聊内容：",
    ...selected.map((message) => `- ${message.actor.replace(/^\[群聊回忆·|\]\s*/g, " ").trim()}：${message.content.slice(0, 180)}`),
  ].join("\n");
}
