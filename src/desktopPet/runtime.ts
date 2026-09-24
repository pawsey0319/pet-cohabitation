import { AppState } from "react-native";
import { createPetRepository, type PetRepository } from "../data/petRepository";
import type { PetPrivateMessage } from "../data/types";
import { requireSupabase } from "../lib/supabase";
import { privateSendQueue } from "../pets/privateSendQueue";
import { prepareVisionAttachment } from "../vision/repository";
import { getDesktopPetModule } from "./native";
import { approvedDesktopImage, parseDesktopCommand, type ApprovedPetDisplay, type DesktopPetCommand, type DesktopPetLine } from "./contracts";

const contexts = new Map<string, { petId: string; repository: PetRepository; history: readonly PetPrivateMessage[]; partial: string; phase: string; activeRequest?: string; unsubscribe: () => void }>();
let processing: Promise<void> | null = null;
let rerun = false;
let authInstalled = false;

async function assertOwner(ownerId: string, petId: string) {
  const native = getDesktopPetModule(), state = await native?.status();
  const session = (await requireSupabase().auth.getSession()).data.session;
  if (!state?.running || state.ownerId !== ownerId || state.petId !== petId || session?.user.id !== ownerId) throw new Error("desktop_account_changed");
  return session;
}

async function publish(ownerId: string) {
  const context = contexts.get(ownerId); if (!context) return;
  await assertOwner(ownerId, context.petId);
  const queued = privateSendQueue(ownerId).snapshot();
  const existing = new Set(context.history.map(row => row.requestKey).filter(Boolean));
  const lines: DesktopPetLine[] = context.history.filter(row => row.conversationKind === "companion").slice(-30).map(row => ({ id: row.id, role: row.role, content: row.content, status: "sent" }));
  for (const row of queued) if (!existing.has(row.id)) lines.push({ id: row.id, role: "owner", content: row.content, status: row.status });
  await getDesktopPetModule()?.publish(ownerId, context.petId, JSON.stringify({ lines, partial: context.partial, phase: context.phase, activeRequest: context.activeRequest,
    failedRequests: queued.filter(row => row.status === "failed").map(row => ({ id: row.id, error: row.error ?? "暂时未完成，可以重试。" })) }));
}

async function refresh(ownerId: string) {
  const context = contexts.get(ownerId); if (!context) return;
  const history = await context.repository.listPrivateMessages();
  await assertOwner(ownerId, context.petId);
  if (contexts.get(ownerId) !== context) return;
  context.history = history;
  await publish(ownerId);
}

function discardContext(owner: string) {
  const previous = contexts.get(owner); if (!previous) return;
  previous.unsubscribe(); contexts.delete(owner);
}

function installLifecycle() {
  if (authInstalled) return; authInstalled = true;
  const client = requireSupabase();
  client.auth.onAuthStateChange((_event, session) => {
    // Do not await Supabase calls in its own auth callback.
    for (const owner of contexts.keys()) if (session?.user.id !== owner) {
      discardContext(owner); void getDesktopPetModule()?.stop(owner);
    }
  });
  getDesktopPetModule()?.addListener("onDesktopPetState", state => {
    if (state.running) client.auth.startAutoRefresh();
    else {
      for (const owner of contexts.keys()) discardContext(owner);
      if (AppState.currentState !== "active") client.auth.stopAutoRefresh();
    }
  });
}

async function contextFor(command: DesktopPetCommand) {
  const session = await assertOwner(command.ownerId, command.petId);
  const old = contexts.get(command.ownerId);
  if (old?.petId === command.petId && command.kind !== "bootstrap") return old;
  if (old) discardContext(command.ownerId);
  const repository = createPetRepository({ id: session.user.id, email: session.user.email ?? "", nickname: "主人", avatarUrl: null, isAdmin: false });
  const dashboard = await repository.getDashboard();
  if (dashboard.pet?.id !== command.petId || dashboard.pet.status !== "confirmed" || !dashboard.currentAsset) throw new Error("请先确认异宠形象。");
  const display = await requireSupabase().functions.invoke("pet-display", { body: { action: "status", pet_id: command.petId } });
  if (display.error || display.data?.error) throw new Error("暂时无法验证异宠形象，请联网后重试。");
  const state = display.data as ApprovedPetDisplay;
  const image = approvedDesktopImage(state, dashboard.currentAsset.id, process.env.EXPO_PUBLIC_SUPABASE_URL ?? "");
  await assertOwner(command.ownerId, command.petId);
  await getDesktopPetModule()?.applyImage(command.ownerId, command.petId, image, `${dashboard.currentAsset.id}:${state.preference.version}:${state.job!.id}`, dashboard.pet.name);
  const context = { petId: command.petId, repository, history: [] as readonly PetPrivateMessage[], partial: "", phase: "", activeRequest: undefined as string | undefined, unsubscribe: () => {} };
  contexts.set(command.ownerId, context);
  const queue = privateSendQueue(command.ownerId); await queue.load();
  const offQueue = queue.subscribe(() => { void publish(command.ownerId).catch(() => undefined); });
  // The renderer need not be mounted. Both main chat and the overlay read the same rows.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const channel = requireSupabase().channel(`desktop-pet:${command.ownerId}`).on("postgres_changes", {
    event: "*", schema: "public", table: "pet_private_threads", filter: `pet_id=eq.${command.petId}`,
  }, () => { clearTimeout(timer); timer = setTimeout(() => { void refresh(command.ownerId).catch(() => undefined); }, 180); })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pets", filter: `id=eq.${command.petId}` }, payload => {
      if (payload.new.current_asset_id !== dashboard.currentAsset!.id) void getDesktopPetModule()?.invalidateImage(command.ownerId, command.petId);
    }).on("postgres_changes", { event: "UPDATE", schema: "public", table: "pet_display_preferences", filter: `pet_id=eq.${command.petId}` }, payload => {
      if (payload.new.version !== state.preference.version || !payload.new.use_transparent || payload.new.approved_job_id !== state.job?.id) void getDesktopPetModule()?.invalidateImage(command.ownerId, command.petId);
    }).subscribe();
  context.unsubscribe = () => { clearTimeout(timer); offQueue(); void requireSupabase().removeChannel(channel); };
  await refresh(command.ownerId);
  return context;
}

async function execute(command: DesktopPetCommand) {
  const native = getDesktopPetModule();
  const context = await contextFor(command), queue = privateSendQueue(command.ownerId);
  if (command.kind === "send") await queue.enqueue(command.requestId!, command.content!);
  if (command.kind === "retry") await queue.retry(command.requestId!);
  if (command.kind === "stop_reply") {
    await context.repository.stopPrivateReply(command.requestId!);
    await queue.remove(command.requestId!);
    context.partial = ""; context.phase = "已停止回答；已经创建的事项仍保留。";
  }
  // Native retains its immutable command until the shared durable queue accepts it.
  await native?.completeCommand(command.id, command.ownerId, null);
  if (["send", "retry", "bootstrap"].includes(command.kind)) await queue.flush(async (row, signal) => {
    await assertOwner(command.ownerId, command.petId);
    context.activeRequest = row.id; context.partial = ""; context.phase = "正在回应";
    try {
      const current = await context.repository.getCompanionContext();
      let attachment = row.attachment?.asset;
      if (row.attachment && !attachment) {
        attachment = (await prepareVisionAttachment(command.ownerId, row.attachment)).asset;
        await queue.recordUploaded(row.id, attachment);
      }
      await context.repository.chat(row.content, row.id, "companion", {
        signal, contextRevision: current.revision,
        ...(attachment ? { imageAssetId: attachment.id, imageAssetVersion: attachment.version } : {}),
        onEvent(event) {
          if (contexts.get(command.ownerId) !== context) return;
          if (event.type === "text") context.partial = event.content ?? "";
          if (event.type === "phase") context.phase = event.phase === "confirming" ? "正在核实回复" : "正在回应";
          if (event.type === "error") { context.partial = ""; context.phase = "回应已失效或中断，可重试。"; }
          void publish(command.ownerId).catch(() => undefined);
        },
      });
      await assertOwner(command.ownerId, command.petId);
      context.partial = ""; context.phase = "";
      await refresh(command.ownerId);
    } catch (reason) {
      context.partial = ""; context.phase = reason instanceof Error ? reason.message : "回应中断，可重试。";
      throw reason;
    } finally {
      context.activeRequest = undefined; void publish(command.ownerId).catch(() => undefined);
    }
  });
  await refresh(command.ownerId);
}

/** One coordinator for every headless wake-up; account and native generation are rechecked before output. */
export async function runDesktopPetCommands(): Promise<void> {
  if (processing) {
    rerun = true;
    // A Stop click must interrupt the active request; it must never wait behind that reply.
    const raw = await getDesktopPetModule()?.pendingCommands();
    for (const value of raw ? JSON.parse(raw) : []) {
      const command = parseDesktopCommand(value);
      if (command.kind === "stop_reply") await execute(command);
    }
    return processing;
  }
  installLifecycle(); requireSupabase().auth.startAutoRefresh();
  processing = (async () => {
    do {
      rerun = false;
      const raw = await getDesktopPetModule()?.pendingCommands();
      const commands: unknown[] = raw ? JSON.parse(raw) : [];
      for (const value of commands) {
        if ((value as { error?: unknown })?.error) continue;
        const command = parseDesktopCommand(value);
        try { await execute(command); }
        catch (reason) {
          await getDesktopPetModule()?.completeCommand(command.id, command.ownerId, reason instanceof Error ? reason.message : "桌宠暂时不可用。");
          if (command.kind === "bootstrap") await getDesktopPetModule()?.stop(command.ownerId);
        }
      }
    } while (rerun);
  })().finally(() => { processing = null; });
  return processing;
}
