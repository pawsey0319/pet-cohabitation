import type { PreferenceView } from "../../supabase/functions/_shared/preferenceMemory";
import type { PetPersonalMemory, PetPrivateMessage } from "../data/types";

export const PERSONAL_MEMORY_LIMIT = 20;
export const PERSONAL_MEMORY_LENGTH = 400;
export const REUNION_AFTER_MS = 6 * 60 * 60 * 1000;

export function validatePersonalMemory(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("请写下希望它记住的内容");
  if ([...trimmed].length > PERSONAL_MEMORY_LENGTH) throw new Error("每条记忆最多 400 字");
  return trimmed;
}

export function currentPrivateMessages(messages: readonly PetPrivateMessage[], startedAt: string | null): readonly PetPrivateMessage[] {
  // Supabase timestamps retain microseconds; Date.parse alone can re-include a cleared message.
  const micros = (value: string) => Date.parse(value) * 1000 + Number((value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3, 6));
  return messages.filter((message) => !startedAt || micros(message.createdAt) >= micros(startedAt));
}

export function privateContinuation(messages: readonly PetPrivateMessage[], startedAt: string | null, enteredAt: number, preferences: readonly PreferenceView[] = []) {
  const previous = [...currentPrivateMessages(messages, startedAt)]
    .filter((item) => Date.parse(item.createdAt) < enteredAt)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const message = previous.find((item) => item.role === "owner" && item.content.trim()
    && !preferences.some((view)=>view.latestSourceMessageId!==item.id && Date.parse(view.lastExpressedAt)>Date.parse(item.createdAt) && item.content.includes(view.object))
    && !/^(嗯+|哦+|好+|好的|谢谢|哈哈+|晚安|早安|ok|okay)[。！!~～\s]*$/i.test(item.content.trim()));
  if (!message) return null;
  return { message, isReunion: enteredAt - Date.parse(previous[0].createdAt) >= REUNION_AFTER_MS };
}

/** Deterministic local demonstration, not a substitute for a connected language model. */
export function localCompanionReply(content: string, memories: readonly PetPersonalMemory[], recent: readonly PetPrivateMessage[]): string {
  if (/记得|记住|记忆|喜欢|偏好/.test(content) && memories.length) {
    return `你希望我记住的是：${memories.slice(0, 2).map((memory) => memory.content).join("；")}。如果有变化，随时告诉我。`;
  }
  if (/累|难过|烦|不开心|不想说/.test(content)) return "我在。你可以慢慢说，也可以先安静待一会儿，不用急着把事情讲清楚。";
  const previous = [...recent].reverse().find((message) => message.role === "owner");
  if (/继续|接着|刚才|之前/.test(content)) return previous
    ? `刚才你提到：“${previous.content.slice(0, 100)}”。我们可以从这里接着聊，你最想再说说哪一部分？`
    : "这段对话里还没有可以接续的内容。你想从哪里说起，我就从那里听。";
  return "我听着呢。今天有什么想和我说的？一件小事也可以。";
}
