export type VisionAsset = { id: string; version: number; state: "active" | "excluded" | "deleted" };
export type VisionAttachment = { uploadId: string; uri: string; asset?: VisionAsset };
export function parseVisionAttachment(value: unknown): VisionAttachment | null {
 if(!value||typeof value!=="object")return null;const row=value as Partial<VisionAttachment>;
 if(typeof row.uploadId!=="string"||!row.uploadId||typeof row.uri!=="string")return null;
 if(row.asset&&(row.asset.id!==row.uploadId||!Number.isSafeInteger(row.asset.version)||row.asset.version<1||!["active","excluded","deleted"].includes(row.asset.state)))return null;
 return {uploadId:row.uploadId,uri:row.uri,...(row.asset?{asset:{...row.asset}}:{})};
}
export type VisionMemoryDraft = { id: string; content: string | null; version: number; state: "pending" | "confirmed" | "invalidated" };
export function visionError(reason: unknown): string {
 const code = reason instanceof Error ? reason.message : String(reason);
 if (/account_changed|unauthenticated/.test(code)) return "账号已切换，请重新打开图片。";
 if (/version|changed|conflict/.test(code)) return "图片或相关内容已更新，请重新打开后操作。";
 if (/source|asset_unavailable/.test(code)) return "这张图片已删除或停止用于理解，原来源不能重新形成记忆。";
 if (/personal_memory_limit/.test(code)) return "手工记忆已达到 20 条，请先整理已有记忆。";
 if (/vision_unavailable/.test(code)) return "图片理解暂不可用，可以继续用文字交流。";
 if (/vision_memory_invalid/.test(code)) return "记忆内容需要 1～400 个字。";
 return "图片操作暂未完成，已保留当前选择，可以重试。";
}
