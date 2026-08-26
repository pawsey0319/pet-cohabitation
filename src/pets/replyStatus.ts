import type { PetPrivateMessage } from "../data/types";

export type ActivePetReplyStatus = Exclude<PetPrivateMessage["replyStatus"], null | undefined | "succeeded" | "failed">;

const STAGES: Readonly<Record<ActivePetReplyStatus, { title: string; detail: string }>> = {
  queued: { title: "已送达", detail: "异宠已经听见，正在接住这个问题。" },
  classifying: { title: "正在理解", detail: "正在判断这是陪伴聊天、群聊回忆，还是需要委托主 Agent。" },
  retrieving: { title: "正在查找群聊", detail: "正在检索你加入后仍有权查看的消息，包括已读和未读。" },
  thinking: { title: "正在组织回答", detail: "相关上下文已经准备好，异宠正在形成具体回复。" },
};

export function petReplyStage(status: ActivePetReplyStatus) { return STAGES[status]; }

export function petReplyFailureText(code?: string | null): string {
  if (code === "text_model_network_error") return "模型源站当前无法连接。基础聊天数据没有丢失，可以稍后重试。";
  if (code === "text_model_timeout") return "模型思考超时，这条问题可以沿用原请求重试。";
  if (code?.startsWith("quota_exceeded")) return "今天的异宠回答额度已经用完。";
  if (code === "legacy_reply_missing") return "这条旧问题当时没有得到完整回复，可以现在重新提问。";
  if (code === "legacy_placeholder_reply") return "旧版只留下了占位句，没有真正回答。现在可以沿用原问题重新执行。";
  return "这次回答没有完成，问题已经保留，可以重试。";
}
