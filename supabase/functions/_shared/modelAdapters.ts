import { z } from "npm:zod@4";

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
const SummarySchema = z.object({
  summary: z.string().min(1).max(1800),
  confirmed: z.array(z.string().max(300)).max(10),
  suggestions: z.array(z.string().max(300)).max(10),
  pending_people: z.array(z.string().max(300)).max(10),
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

async function chatJson<T>(messages: readonly ChatMessage[], schema: z.ZodType<T>): Promise<T> {
  if (mockMode()) throw new Error("mock_result_required");
  let response: Response;
  try {
    response = await fetchWithRetry(() => fetch(endpoint(required("TEXT_API_BASE_URL"), "chat/completions"), {
      method: "POST",
      headers: { Authorization: `Bearer ${required("TEXT_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: required("TEXT_MODEL"), messages, temperature: 0.55, response_format: { type: "json_object" } }),
      signal: AbortSignal.timeout(30_000),
    }));
  } catch (reason) { throw normalizedRequestError("text", reason); }
  if (!response.ok) throw await responseError("text", response);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("text_model_missing_content");
  let parsed: unknown;
  try {
    const trimmed = content.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    parsed = JSON.parse(fenced?.[1]?.trim() ?? trimmed);
  } catch { throw new Error("text_model_invalid_json"); }
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
  }): Promise<z.infer<typeof PetReplySchema>> {
    if (mockMode()) return PetReplySchema.parse({
      content: input.contextPolicy === "owner_private_cross_space" && input.messages.some((message) => message.actor.startsWith("[群聊回忆"))
        ? `${input.petName}记得。你加入过的关系空间里，最近确实有这些对话，我把来源也一起带回来了。`
        : input.ownerPolicy === "wait_for_owner"
        ? "这件事还是等主人自己回来回答比较好。我可以先陪你把问题记下来。"
        : input.ownerPolicy === "guess_low_risk"
          ? `我猜主人可能会先想一想再回答。不过这只是我的猜测呀。`
          : `${input.petName}听见啦。我想先凑近观察一下，再告诉你我的发现。`,
      concerns_owner: input.ownerPolicy !== "pet_only",
      risk: input.ownerPolicy === "wait_for_owner" ? "high" : input.ownerPolicy === "guess_low_risk" ? "low" : "none",
    });
    const contextRule = input.contextPolicy === "owner_private_cross_space"
      ? "你正在与主人进行仅主人可见的私聊。可以使用系统已按成员权限、加入时间和异宠参与权限过滤后的跨空间群聊回忆；不要说自己听不到其他群，也不要杜撰未提供的内容。引用回忆时用‘我记得你在某空间……’自然概括，来源会由界面另行展示。"
      : "你只使用当前关系空间提供的上下文，严禁暗示知道其他空间或主人私聊。";
    return chatJson([
      { role: "system", content: `你是成长型异宠“${input.petName}”，不是主人本人。人格摘要：${input.personality || "正在形成"}\n成长风格信号：${input.styleSignals || "暂无"}\n${contextRule}消息必须明确是异宠口吻。ownerPolicy=${input.ownerPolicy}：pet_only 只谈你自己；guess_low_risk 可以用“我猜主人可能……”表达低风险猜测；wait_for_owner 必须拒绝代答并等待主人。不得替主人承诺见面、关系变化、冲突立场、位置、健康、消费、财务或敏感授权。输出 JSON：content, concerns_owner, risk(none|low|high)。concerns_owner 必须是 JSON 布尔值 true/false，不能是字符串。` },
      { role: "user", content: `空间最近消息：\n${input.messages.map((item) => `${item.actor}: ${item.content}`).join("\n")}\n\n当前消息：${input.currentMessage}` },
    ], PetReplySchema);
  }

  async planPetRecall(input: { question: string; spaces: readonly { name: string }[] }): Promise<z.infer<typeof RecallPlanSchema>> {
    if (mockMode()) {
      const space = input.spaces.find((item) => input.question.includes(item.name));
      return RecallPlanSchema.parse({
        mode: space ? "recent_space" : /之前|以前|群里|说过|聊过|记得|回忆/.test(input.question) ? "recent_owner" : "none",
        space_names: space ? [space.name] : [], keywords: [], sender_scope: "owner", limit: 30,
      });
    }
    return chatJson([
      { role: "system", content: "你只负责制定私聊记忆检索计划，不回答用户。若用户问自己之前在群里说过什么，选择 recent_owner；点名某空间选 recent_space；查询某个事件、人物或话题选 search_all；与群聊回忆无关选 none。space_names 只能从给定空间名中选择；keywords 提取有区分度的原词，不能包含‘之前、群里、记得、说过’等泛词。输出 JSON：mode, space_names, keywords, sender_scope(owner|any), limit。" },
      { role: "user", content: JSON.stringify(input) },
    ], RecallPlanSchema);
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

  async summarizeSpace(input: { messages: readonly { actor: string; content: string }[] }): Promise<z.infer<typeof SummarySchema>> {
    if (mockMode()) return { summary: "大家围绕近况和下一次共同活动聊了聊。", confirmed: [], suggestions: ["可以继续确认一个大家都方便的时间"], pending_people: ["真实安排仍等待本人确认"] };
    return chatJson([
      { role: "system", content: "你是关系空间公共主 Agent。客观总结当前空间，不读取跨空间信息。严格区分：已确认、Agent 建议、待本人确认。异宠的话不算主人的承诺。输出 JSON：summary, confirmed, suggestions, pending_people。" },
      { role: "user", content: input.messages.map((item) => `${item.actor}: ${item.content}`).join("\n") },
    ], SummarySchema);
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
  const hue = [...prompt].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><radialGradient id="b"><stop stop-color="hsl(${hue} 70% 84%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360} 55% 48%)"/></radialGradient></defs><rect width="1024" height="1024" rx="180" fill="#201d3d"/><path d="M258 440C184 168 448 118 516 278 642 114 862 262 750 456 886 674 698 880 494 796 292 892 116 650 258 440Z" fill="url(#b)"/><ellipse cx="407" cy="485" rx="38" ry="55" fill="#25213f"/><ellipse cx="612" cy="485" rx="38" ry="55" fill="#25213f"/><path d="M434 628Q516 690 590 620" fill="none" stroke="#25213f" stroke-width="32" stroke-linecap="round"/></svg>`;
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
