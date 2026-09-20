export type WorkStatus = "pending_acceptance" | "not_started" | "in_progress" | "pending_review" | "completed" | "cancelled";
export type WorkKind = "goal" | "milestone" | "task";
export type WorkItem = {
  id: string; owner_id: string | null; space_id: string | null; parent_id: string | null;
  kind: WorkKind; title: string; description: string; status: WorkStatus; assignee_id: string | null;
  due_at: string | null; publication: "draft" | "published"; approval: "none" | "all" | "majority";
  participants: string[]; review_required: boolean; completion_note: string;
  version: number; terms_version: number; terms_expires_at: string | null; terms_valid: boolean;
  accepted_terms_version: number | null; source_private_message_id: string | null;
  created_at: string; updated_at: string; sync_state?: "pending" | "conflict";
};
export type WorkInput = Partial<Pick<WorkItem,"kind"|"title"|"description"|"space_id"|"parent_id"|"assignee_id"|"due_at"|"approval"|"participants"|"review_required"|"terms_expires_at"|"source_private_message_id"|"completion_note">> & {
  confirmed?: boolean; approved?: boolean; material?: Omit<WorkMaterial,"id"|"item_id"|"author_id"|"created_at">;
};
/** An editable conversational suggestion has no persistence or side effect until accepted. */
export type WorkDraft = { type: "work_draft"; input: WorkInput; clarification?: string };
export type WorkAction = "create"|"publish"|"edit"|"accept"|"reject"|"confirm"|"decline"|"progress"|"complete"|"review"|"cancel"|"attach";
export type WorkRequest = { action: WorkAction; request_id: string; item_id?: string; expected_version?: number; input: WorkInput };
export type WorkReceipt = { item: WorkItem; outcome: "created"|"updated"|"pending_confirmation"|"completed"|"cancelled"|"pending_sync" };
export type WorkConfirmation = { item_id: string; terms_version: number; user_id: string; decision: "pending"|"agreed"|"declined"|"invalidated"; decided_at: string | null };
export type WorkMaterial = { id: string; item_id: string; author_id: string | null; kind: "note"|"link"|"image"|"message"; content: string; source_message_id?: string | null; is_completion: boolean; created_at: string; url?: string };
export type WorkDetail = { item: WorkItem; confirmations: WorkConfirmation[]; materials: WorkMaterial[]; activity: { id: string; action: string; actor_id: string | null; detail: Record<string,unknown>; created_at: string }[]; children: WorkItem[] };
export type WorkSuggestion = { id: string; space_id: string; title: string; description: string; sources: {message_id: string; quote: string}[]; accepted_item_id: string | null; invalidated: boolean };
export type WorkAuthorization = { space_id: string; version: number; active_since: string | null };
export const workStatusLabel: Record<WorkStatus,string> = { pending_acceptance:"待接受",not_started:"待开始",in_progress:"进行中",pending_review:"待验收",completed:"已完成",cancelled:"已取消" };
export const workKindLabel: Record<WorkKind,string> = {goal:"目标",milestone:"阶段",task:"任务"};
