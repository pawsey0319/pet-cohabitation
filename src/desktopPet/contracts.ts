export type DesktopPetStatus = {
  supported: boolean; permission: boolean; running: boolean; hidden: boolean;
  ownerId?: string; petId?: string; error?: string; size?: number; imageReady?: boolean;
  draftWrites?: number; draftWriteMaxMs?: number; draftWriteFailures?: number;
};
export type DesktopPetCommand = {
  id: string; ownerId: string; petId: string;
  kind: "bootstrap" | "refresh" | "send" | "retry" | "stop_reply";
  content?: string; requestId?: string;
};
export type DesktopPetLine = {
  id: string; role: "owner" | "pet"; content: string;
  status?: "queued" | "sending" | "failed" | "sent";
};
export type ApprovedPetDisplay = {
  source_asset_id: string; url: string | null;
  preference: { version: number; use_transparent: boolean; approved_job_id?: string | null;
    approved_source_asset_id?: string | null; approved_display_version?: number | null; approved_at?: string | null };
  job: { id: string; status: string } | null;
};

/** Finished background removal is not visual approval. Never fall back to an opaque original. */
export function approvedDesktopImage(state: ApprovedPetDisplay, currentAssetId: string, supabaseUrl: string): string {
  const p = state.preference;
  if (!p?.use_transparent || state.job?.status !== "succeeded" || !p.approved_at ||
      state.source_asset_id !== currentAssetId || p.approved_source_asset_id !== currentAssetId ||
      p.approved_job_id !== state.job.id || p.approved_display_version !== p.version || !state.url) {
    throw new Error("请先在异宠形象设置中预览并确认透明本体，再开启桌宠。");
  }
  const image = new URL(state.url), configured = new URL(supabaseUrl);
  if (image.protocol !== "https:" || image.origin !== configured.origin || !image.pathname.startsWith("/storage/v1/object/sign/")) {
    throw new Error("透明形象地址无效，请重新确认形象。");
  }
  return image.href;
}

export function parseDesktopCommand(value: unknown): DesktopPetCommand {
  const row = value as Partial<DesktopPetCommand> | null;
  if (!row || typeof row.id !== "string" || !row.id || typeof row.ownerId !== "string" || !row.ownerId ||
      typeof row.petId !== "string" || !row.petId || !["bootstrap", "refresh", "send", "retry", "stop_reply"].includes(row.kind ?? "")) {
    throw new Error("desktop_command_invalid");
  }
  if (row.kind === "send" && (typeof row.content !== "string" || !row.content.trim() || row.content.length > 4000)) throw new Error("desktop_message_invalid");
  if (["send", "retry", "stop_reply"].includes(row.kind!) && (typeof row.requestId !== "string" || !row.requestId)) throw new Error("desktop_request_invalid");
  return row as DesktopPetCommand;
}
