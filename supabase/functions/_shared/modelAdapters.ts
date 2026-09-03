import { z } from "npm:zod@4";
import { fallbackRecallAnswer, normalizeDigestStringList } from "./answerQuality.ts";
import { extractJsonValue } from "./jsonExtraction.ts";

const JsonBooleanSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return value;
}, z.boolean());

const PetReplySchema = z.object({
  content: z.string().min(1).max(1200),
  concerns_owner: JsonBooleanSchema.default(false),
  risk: z.enum(["none", "low", "high"]).default("none"),
});
const RouteSchema = z.object({ pet_ids: z.array(z.string().uuid()).max(3) });
const SignalsSchema = z.object({ signals: z.array(z.object({
  tendency: z.string().min(1).max(500),
  rationale: z.string().min(1).max(1000),
  confidence: z.number().min(0).max(1),
})).max(3) });
const DigestTextListSchema = z.preprocess(normalizeDigestStringList, z.array(z.string().min(1).max(500)).max(30));
const DigestModelSchema = z.object({
  topics: DigestTextListSchema.default([]),
  decisions: DigestTextListSchema.default([]),
  todos: DigestTextListSchema.default([]),
  schedules: DigestTextListSchema.default([]),
  pending: DigestTextListSchema.default([]),
  source_message_ids: z.array(z.string().min(1).max(80)).max(240).default([]),
});
const SpaceQuerySchema = z.object({ answer: z.string().min(1).max(2400) });
const PetSeedSchema = z.object({
  personality_seed_prompt: z.string().min(20).max(2400),
  visual_seed_prompt: z.string().min(20).max(3000),
  negative_seed_prompt: z.string().min(1).max(1600),
  seed_summary: z.string().min(10).max(1000),
});
const PetManagerIntentSchema = z.object({
  mode: z.enum(["query", "action", "clarify"]),
  request_kind: z.enum(["delegated_message", "group_task", "group_plan", "group_schedule", "personal_reminder", "group_reminder"]).nullable().default(null),
  target_space_name: z.string().max(80).nullable().default(null),
  exact_content: z.string().max(4000).nullable().default(null),
  clarification: z.string().max(500).nullable().default(null),
});
const RecallPlanSchema = z.object({
  mode: z.enum(["recent_owner", "recent_space", "search_all", "none"]),
  space_names: z.array(z.string().max(80)).max(10).default([]),
  keywords: z.array(z.string().min(1).max(40)).max(8).default([]),
  sender_scope: z.enum(["owner", "any"]).default("owner"),
  limit: z.number().int().min(1).max(60).default(30),
});

type ChatMessage = Readonly<{ role: "system" | "user" | "assistant"; content: string }>;

function required(name: string): string {
  const value = Deno.env.get(name)?.trim(); if (!value) throw new Error(`${name}_missing`); return value;
}
function endpoint(base: string, path: string): string { return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`; }
function mockMode(): boolean { return Deno.env.get("MODEL_MOCK_MODE") === "true"; }

async function fetchWithRetry(factory: () => Promise<Response>): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await factory();
      if (attempt === 1 && (response.status === 429 || response.status >= 500)) {
        await response.body?.cancel().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 600));
        continue;
      }
      return response;
    } catch (reason) {
      lastError = reason;
      if (attempt === 2) throw reason;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  throw lastError ?? new Error("model_request_failed");
}

function normalizedRequestError(kind: "text" | "image", reason: unknown): Error {
  if (reason instanceof Error && (reason.name === "TimeoutError" || reason.name === "AbortError")) return new Error(`${kind}_model_timeout`);
  if (reason instanceof Error && /_model_(timeout|content_blocked|rate_limited|http_\d+)$/.test(reason.message)) return reason;
  return new Error(`${kind}_model_network_error`);
}

async function responseError(kind: "text" | "image", response: Response): Promise<Error> {
  let providerCode = "";
  try {
    const payload = await response.clone().json();
    providerCode = String(payload?.error?.code ?? payload?.error?.type ?? payload?.code ?? "").toLowerCase();
  } catch { /* Response bodies are intentionally not logged. */ }
  if (response.status === 408 || response.status === 504) return new Error(`${kind}_model_timeout`);
  if (response.status === 429) return new Error(`${kind}_model_rate_limited`);
  if (/content|safety|moderation|policy/.test(providerCode)) return new Error(`${kind}_model_content_blocked`);
  return new Error(`${kind}_model_http_${response.status}`);
}

async function chatJson<T>(messages: readonly ChatMessage[], schema: z.ZodType<T>, options: Readonly<{ maxTokens?: number }> = {}): Promise<T> {
  if (mockMode()) throw new Error("mock_result_required");
  let response: Response;
  try {
    response = await fetchWithRetry(() => fetch(endpoint(required("TEXT_API_BASE_URL"), "chat/completions"), {
      method: "POST",
      headers: { Authorization: `Bearer ${required("TEXT_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: required("TEXT_MODEL"), messages, temperature: 0.35,
        max_tokens: options.maxTokens ?? 1200, reasoning_effort: "low",
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30_000),
    }));
  } catch (reason) { throw normalizedRequestError("text", reason); }
  if (!response.ok) throw await responseError("text", response);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("text_model_missing_content");
  const parsed = extractJsonValue(content);
  return schema.parse(parsed);
}

export class TextModelAdapter {
  static modelName(): string { return mockMode() ? "mock-text" : required("TEXT_MODEL"); }

  async generatePetReply(input: {
    petName: string;
    personality: string;
    styleSignals: string;
    messages: readonly { actor: string; content: string }[];
    currentMessage: string;
    ownerPolicy: "pet_only" | "guess_low_risk" | "wait_for_owner";
    contextPolicy?: "single_space" | "owner_private_cross_space";
    requireDirectRecall?: boolean;
    responseStyle?: "concise" | "balanced" | "detailed";
  }): Promise<z.infer<typeof PetReplySchema>> {
    const recalledMessages = input.messages.filter((message) => message.actor.startsWith("[群聊回忆"));
    if (mockMode()) return PetReplySchema.parse({
      content: input.contextPolicy === "owner_private_cross_space" && recalledMessages.length
        ? fallbackRecallAnswer(recalledMessages)
        : input.ownerPolicy === "wait_for_owner"
        ? "这件事还是等主人自己回来回答比较好。我可以先陪你把问题记下来。"
        : input.ownerPolicy === "guess_low_risk"
          ? `我猜主人可能会先想一想再回答。不过这只是我的猜测呀。`
          : `${input.petName}听见啦。我想先凑近观察一下，再告诉你我的发现。`,
      concerns_owner: input.ownerPolicy !== "pet_only",
      risk: input.ownerPolicy === "wait_for_owner" ? "high" : input.ownerPolicy === "guess_low_risk" ? "low" : "none",
    });
    const styleRule = input.responseStyle === "detailed"
      ? "回答偏详细：先给结论，再按话题分组，最多6个要点。"
      : input.responseStyle === "balanced"
        ? "回答均衡：先给结论，再按话题分组，最多4个要点。"
        : "回答简洁：先用1至2句给结论，再按话题合并成最多3个要点；没有真实待办就不要增加待办栏目。";
    const contextRule = input.contextPolicy === "owner_private_cross_space"
      ? `你正在与主人进行仅主人可见的私聊。可以使用系统已按成员权限和加入时间过滤后的跨空间群聊回忆；不要说自己听不到其他群，也不要杜撰未提供的内容。只要上下文中存在[群聊回忆]，第一段必须直接回答问题。${styleRule}不要按消息顺序逐条复述，合并重复表达。系统给出的发言者标签是已经按 sender_id 归一后的唯一身份；同一标签只能视为一个人，不得根据旧称呼、群昵称或消息正文另造第二个身份。严禁寒暄、卖萌开场以及“我先观察/查看/整理，之后再告诉你”。来源会由界面另行展示。${input.requireDirectRecall ? "这是严格重试：上一版没有解决问题，本次必须引用提供的具体消息作答。" : ""}`
      : "你只使用当前关系空间提供的上下文，严禁暗示知道其他空间或主人私聊。";
    return chatJson([
      { role: "system", content: `你是成长型异宠“${input.petName}”，不是主人本人。人格摘要：${input.personality || "正在形成"}\n成长风格信号：${input.styleSignals || "暂无"}\n${contextRule}消息必须明确是异宠口吻。ownerPolicy=${input.ownerPolicy}：pet_only 只谈你自己；guess_low_risk 可以用“我猜主人可能……”表达低风险猜测；wait_for_owner 必须拒绝代答并等待主人。不得替主人承诺见面、关系变化、冲突立场、位置、健康、消费、财务或敏感授权。输出 JSON：content, concerns_owner, risk(none|low|high)。concerns_owner 必须是 JSON 布尔值 true/false，不能是字符串。` },
      { role: "user", content: `空间最近消息：\n${input.messages.map((item) => `${item.actor}: ${item.content}`).join("\n")}\n\n当前消息：${input.currentMessage}` },
    ], PetReplySchema, { maxTokens: input.contextPolicy === "owner_private_cross_space" && input.responseStyle !== "detailed" ? 440 : 640 });
  }

  async planPetRecall(input: { question: string; spaces: readonly { name: string }[] }): Promise<z.infer<typeof RecallPlanSchema>> {
    if (mockMode()) {
      const space = input.spaces.find((item) => input.question.includes(item.name));
      return RecallPlanSchema.parse({
        mode: space ? "recent_space" : /之前|以前|群里|说过|聊过|记得|回忆|消息|近况/.test(input.question) ? (/我.{0,8}(说|发)/.test(input.question) ? "recent_owner" : "search_all") : "none",
        space_names: space ? [space.name] : [], keywords: [], sender_scope: /我.{0,8}(说|发)/.test(input.question) ? "owner" : "any", limit: 30,
      });
    }
    return chatJson([
      { role: "system", content: "你只负责制定主人私聊中的群消息检索计划，不回答用户。异宠可以检索主人当前仍有权读取、且加入空间之后的所有成员文字消息。只有用户明确问‘我自己说过什么’时选择 recent_owner/sender_scope=owner；点名空间选 recent_space；询问群里发生什么、其他人说了什么、某事件或话题选 search_all/sender_scope=any；无关选 none。space_names 只能从给定空间名中选择；keywords 提取有区分度的原词。输出 JSON：mode, space_names, keywords, sender_scope(owner|any), limit。" },
      { role: "user", content: JSON.stringify(input) },
    ], RecallPlanSchema, { maxTokens: 400 });
  }

  async routePetRelevance(input: { message: string; candidates: readonly { petId: string; petName: string; ownerName: string }[] }): Promise<readonly string[]> {
    if (mockMode()) {
      const first = input.candidates.find((candidate) => input.message.includes(candidate.petName) || input.message.includes(candidate.ownerName));
      return first ? [first.petId] : [];
    }
    const result = await chatJson([
      { role: "system", content: "你是低成本相关性路由器。只选择与消息高度相关的异宠，最多 3 个；无关就返回空数组。禁止生成回复。输出 JSON：pet_ids。" },
      { role: "user", content: JSON.stringify(input) },
    ], RouteSchema);
    const allowed = new Set(input.candidates.map((candidate) => candidate.petId));
    return result.pet_ids.filter((id) => allowed.has(id));
  }

  async extractStyleSignals(input: { ownerMessage: string; context: readonly { actor: string; content: string }[]; sourceLabel: string }): Promise<z.infer<typeof SignalsSchema>["signals"]> {
    if (mockMode()) return [{ tendency: "先观察再回应", rationale: "主人先描述情境，再表达自己的期待。", confidence: 0.68 }];
    const result = await chatJson([
      { role: "system", content: `只观察目标主人自己的表达方式，提取可纠正的概括性互动倾向。其他成员的话只允许作为语境，绝不能给其他成员建画像，不能复述私密原文，不能推断健康、财务、住址等敏感属性。来源：${input.sourceLabel}。输出 JSON：signals[{tendency,rationale,confidence}]，最多 3 条。` },
      { role: "user", content: `目标主人当前发言：${input.ownerMessage}\n语境：\n${input.context.map((item) => `${item.actor}: ${item.content}`).join("\n")}` },
    ], SignalsSchema);
    return result.signals;
  }

  async summarizeSpace(input: { messages: readonly { id: string; actor: string; content: string; createdAt: string }[] }): Promise<z.infer<typeof DigestModelSchema>> {
    if (mockMode()) {
      const available = input.messages.filter((message) => message.content.trim());
      const concrete = available.length > 12 ? [available[0], ...available.slice(-11)] : available;
      return DigestModelSchema.parse({
        topics: concrete.map((message) => `${message.actor}：${message.content.slice(0, 180)}`),
        decisions: [], todos: [], schedules: [], pending: [],
        source_message_ids: concrete.map((message) => message.id),
      });
    }
    return chatJson([
      { role: "system", content: "你是关系空间公共主 Agent。只总结给定消息，必须写出具体话题、人物、时间、结论和待办，禁止使用‘大家聊了近况’之类空泛句。严格区分已确认与待确认；异宠发言只能作为异宠观点，不能算主人的承诺。每一项都必须能追溯到给定 message_id。输出 JSON：topics, decisions, todos, schedules, pending, source_message_ids。没有对应内容就返回空数组。" },
      { role: "user", content: input.messages.map((item) => `[${item.id}] ${item.createdAt} ${item.actor}: ${item.content}`).join("\n") },
    ], DigestModelSchema, { maxTokens: 800 });
  }

  async mergeSpaceDigests(input: { chunks: readonly z.infer<typeof DigestModelSchema>[] }): Promise<z.infer<typeof DigestModelSchema>> {
    const unique = (values: readonly string[]) => [...new Set(values)].slice(0, 30);
    if (mockMode()) return DigestModelSchema.parse({
      topics: unique(input.chunks.flatMap((chunk) => chunk.topics)),
      decisions: unique(input.chunks.flatMap((chunk) => chunk.decisions)),
      todos: unique(input.chunks.flatMap((chunk) => chunk.todos)),
      schedules: unique(input.chunks.flatMap((chunk) => chunk.schedules)),
      pending: unique(input.chunks.flatMap((chunk) => chunk.pending)),
      source_message_ids: [...new Set(input.chunks.flatMap((chunk) => chunk.source_message_ids))].slice(0, 240),
    });
    return chatJson([
      { role: "system", content: "把多段群聊简报合并成一份具体、去重的最终简报。保留跨批次的先后关系和冲突，不得增加输入中不存在的事实。异宠发言不算主人承诺。输出 JSON：topics, decisions, todos, schedules, pending, source_message_ids；每类最多 30 项。" },
      { role: "user", content: JSON.stringify(input.chunks) },
    ], DigestModelSchema, { maxTokens: 800 });
  }

  async planPetManagerAction(input: { message: string; spaces: readonly { name: string }[] }): Promise<z.infer<typeof PetManagerIntentSchema>> {
    if (mockMode()) {
      const target = input.spaces.find((space) => input.message.includes(space.name));
      const delegated = /(代发|帮我发|替我发|发到)/.test(input.message);
      const kind = delegated ? "delegated_message"
        : /(?:创建|新建|添加|安排|帮我).{0,8}(?:待办|任务)/.test(input.message) ? "group_task"
          : /(?:创建|新建|添加|安排|帮我).{0,8}(?:日程|时间)/.test(input.message) ? "group_schedule"
            : /(?:提醒我|创建提醒|设置提醒|到点提醒)/.test(input.message) ? (target ? "group_reminder" : "personal_reminder")
              : /(?:制定|发起|创建|帮我|一起).{0,10}计划|计划一下/.test(input.message) ? "group_plan" : null;
      if (!kind) return PetManagerIntentSchema.parse({ mode: "query" });
      if (kind !== "personal_reminder" && !target) return PetManagerIntentSchema.parse({ mode: "clarify", request_kind: kind, clarification: "你想操作哪个关系空间？请说出空间名称。" });
      const exactMatch = input.message.match(/(?:原文|内容|发(?:到)?[^：:]{0,30})[：:]\s*([\s\S]+)$/);
      if (kind === "delegated_message" && !exactMatch?.[1]?.trim()) return PetManagerIntentSchema.parse({ mode: "clarify", request_kind: kind, target_space_name: target?.name ?? null, clarification: "请给出要逐字代发的明确原文，例如“发到旅行群：我周六下午有空”。" });
      return PetManagerIntentSchema.parse({ mode: "action", request_kind: kind, target_space_name: target?.name ?? null, exact_content: exactMatch?.[1]?.trim() ?? null });
    }
    return chatJson([
      { role: "system", content: "你是异宠消息管家的意图路由器，不执行操作。区分普通聊天/消息查询(query)与空间操作(action)。操作类型只能是 delegated_message、group_task、group_plan、group_schedule、personal_reminder、group_reminder。目标空间只能从给定列表精确选择；不明确就 mode=clarify 并追问。代发必须提取用户本次输入中明确给出的逐字原文，绝不能补充、改写或从记忆推断；没有明确原文就 clarify。输出 JSON：mode, request_kind, target_space_name, exact_content, clarification。" },
      { role: "user", content: JSON.stringify(input) },
    ], PetManagerIntentSchema, { maxTokens: 400 });
  }

  async answerSpaceQuery(input: { question: string; messages: readonly { actor: string; content: string }[] }): Promise<z.infer<typeof SpaceQuerySchema>> {
    if (mockMode()) return { answer: `根据这个空间现有的消息，我找到了与“${input.question.slice(0, 32)}”相关的内容；当前没有超出群聊记录的额外结论。` };
    return chatJson([
      { role: "system", content: "你是关系空间公共主 Agent。只根据给定空间消息回答成员的问题，不得使用跨空间信息，不得把异宠发言当作主人的正式承诺。若证据不足要直说。输出 JSON：answer。" },
      { role: "user", content: `问题：${input.question}\n\n空间消息：\n${input.messages.map((item) => `${item.actor}: ${item.content}`).join("\n")}` },
    ], SpaceQuerySchema);
  }

  async composePetSeed(input: { name: string; appearance: string; personality: string; companionship: string; excludedFeatures: string; additionalDescription: string }): Promise<z.infer<typeof PetSeedSchema>> {
    if (mockMode()) return PetSeedSchema.parse({
      personality_seed_prompt: `${input.name}会以“${input.personality}”作为初始性格倾向，并在相处中采用“${input.companionship}”的陪伴方式；它有自己的判断，不机械迎合主人。`,
      visual_seed_prompt: `原创精细像素桌宠，名字是${input.name}。外观期待：${input.appearance}。补充描述：${input.additionalDescription || "保持奇异、有生命感、避免普通猫狗轮廓"}。使用清晰完整的身体结构、可识别器官、标志性配件和小尺寸可读轮廓。`,
      negative_seed_prompt: `不要文字、水印、现有 IP、真人、普通人脸、照搬猫狗模板；排除：${input.excludedFeatures || "无"}。`,
      seed_summary: `${input.name}是一只${input.personality}的异宠，外观朝“${input.appearance}”生长，习惯${input.companionship}。`,
    });
    return chatJson([
      { role: "system", content: "将用户的异宠期待编排成简短 JSON。只输出 personality_seed_prompt、visual_seed_prompt、negative_seed_prompt、seed_summary 四个字符串，每项不超过 120 字。视觉为原创精细像素全身桌宠，轮廓、器官、材质和配件独特，不模仿现有 IP；人格可成长、有独立判断且不情感绑架。" },
      { role: "user", content: JSON.stringify(input) },
    ], PetSeedSchema, { maxTokens: 512 });
  }
}

export type GeneratedImage = Readonly<{ bytes: Uint8Array; mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml" }>;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value); const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function normalizeImagePayload(payload: unknown): Promise<GeneratedImage> {
  const item = (payload as { data?: Array<{ b64_json?: string; url?: string }> })?.data?.[0];
  if (item?.b64_json) return { bytes: decodeBase64(item.b64_json), mimeType: "image/png" };
  if (item?.url) {
    let response: Response;
    try { response = await fetch(item.url, { signal: AbortSignal.timeout(30_000) }); }
    catch (reason) { throw normalizedRequestError("image", reason); }
    if (!response.ok) throw await responseError("image", response);
    const type = response.headers.get("content-type")?.split(";")[0];
    const mimeType = type === "image/jpeg" || type === "image/webp" ? type : "image/png";
    return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType };
  }
  throw new Error("image_model_missing_output");
}

async function mockImage(prompt: string): Promise<GeneratedImage> {
  const hash = [...prompt].reduce((sum, char, index) => (sum + char.charCodeAt(0) * (index + 3)) % 1000003, 0);
  const hue = hash % 360;
  const variant = hash % 5;
  const bodies = [
    `<path d="M248 440C174 180 414 120 500 280 624 112 854 258 756 462 876 680 682 878 500 790 300 888 120 654 248 440Z" fill="url(#b)"/><path d="M300 735Q250 870 372 826M700 735Q750 870 628 826" fill="none" stroke="url(#b)" stroke-width="54" stroke-linecap="round"/>`,
    `<path d="M512 150L650 310 846 350 730 520 770 746 550 690 374 842 338 614 138 510 342 404Z" fill="url(#b)"/><circle cx="512" cy="172" r="46" fill="hsl(${(hue + 120) % 360} 70% 64%)"/>`,
    `<path d="M510 166C680 166 790 310 742 470 884 544 810 760 644 740 572 884 326 834 320 666 130 590 202 344 386 350 394 242 438 166 510 166Z" fill="url(#b)"/><path d="M326 354Q214 212 166 350M704 350Q814 208 858 356" fill="none" stroke="url(#b)" stroke-width="70" stroke-linecap="round"/>`,
    `<ellipse cx="512" cy="500" rx="248" ry="326" fill="url(#b)"/><path d="M360 210Q512 30 664 210M280 500Q106 558 220 710M744 500Q918 558 804 710" fill="none" stroke="url(#b)" stroke-width="72" stroke-linecap="round"/><path d="M420 798L362 904M604 798L662 904" stroke="url(#b)" stroke-width="64" stroke-linecap="round"/>`,
    `<path d="M226 570Q250 248 520 182 814 250 786 566 760 810 516 826 260 800 226 570Z" fill="url(#b)"/><path d="M330 288L250 110 438 238M604 238L790 110 708 304" fill="url(#b)"/><path d="M280 640Q126 682 198 818M750 640Q902 682 832 818" fill="none" stroke="url(#b)" stroke-width="62" stroke-linecap="round"/>`,
  ];
  const eyeY = variant === 3 ? 470 : 492;
  const eyeCount = variant === 2 ? `<circle cx="512" cy="420" r="29" fill="#25213f"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><radialGradient id="b"><stop stop-color="hsl(${hue} 70% 84%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360} 55% 48%)"/></radialGradient></defs><rect width="1024" height="1024" rx="180" fill="#201d3d"/>${bodies[variant]}${eyeCount}<ellipse cx="420" cy="${eyeY}" rx="34" ry="48" fill="#25213f"/><ellipse cx="604" cy="${eyeY}" rx="34" ry="48" fill="#25213f"/><path d="M438 620Q516 ${variant % 2 ? 580 : 682} 590 618" fill="none" stroke="#25213f" stroke-width="30" stroke-linecap="round"/></svg>`;
  return { bytes: new TextEncoder().encode(svg), mimeType: "image/svg+xml" };
}

export class ImageModelAdapter {
  static modelName(): string { return mockMode() ? "mock-image" : required("IMAGE_MODEL"); }

  async generateCandidate(input: { prompt: string; parent?: GeneratedImage | null }): Promise<GeneratedImage> {
    if (mockMode()) return mockImage(input.prompt);
    const base = required("IMAGE_API_BASE_URL"); const apiKey = required("IMAGE_API_KEY");
    let response: Response;
    if (input.parent) {
      const form = new FormData();
      form.append("model", required("IMAGE_MODEL")); form.append("prompt", input.prompt); form.append("size", "1024x1024"); form.append("response_format", "b64_json");
      form.append("image", new Blob([input.parent.bytes], { type: input.parent.mimeType }), `parent.${input.parent.mimeType.split("/")[1]}`);
      try { response = await fetchWithRetry(() => fetch(endpoint(base, "images/edits"), { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(90_000) })); }
      catch (reason) { throw normalizedRequestError("image", reason); }
    } else {
      try { response = await fetchWithRetry(() => fetch(endpoint(base, "images/generations"), { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: required("IMAGE_MODEL"), prompt: input.prompt, size: "1024x1024", response_format: "b64_json" }), signal: AbortSignal.timeout(90_000) })); }
      catch (reason) { throw normalizedRequestError("image", reason); }
    }
    if (!response.ok) throw await responseError("image", response);
    return normalizeImagePayload(await response.json());
  }

  evolveFromParent(input: { prompt: string; parent: GeneratedImage }): Promise<GeneratedImage> {
    return this.generateCandidate(input);
  }
}

export function imageExtension(mimeType: GeneratedImage["mimeType"]): string {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : mimeType === "image/svg+xml" ? "svg" : "png";
}
