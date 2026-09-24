import { type AndroidRelease, type InstalledApp, needsNativeUpdate } from "./release";
export type UpdatePhase = "idle" | "checking" | "native" | "available" | "downloading" | "ready" | "current" | "handedOff" | "error";
export type UpdateState = { phase: UpdatePhase; release: AndroidRelease | null; message: string };
export type UpdateDependencies = {
  installed: InstalledApp; supported: boolean; otaEnabled: boolean;
  release(): Promise<AndroidRelease>;
  checkOTA(): Promise<{ isAvailable: boolean; isRollBackToEmbedded?: boolean; manifest?: unknown }>;
  fetchOTA(): Promise<{ isNew: boolean; isRollBackToEmbedded?: boolean; manifest?: unknown }>;
  reload(): Promise<void>; openURL(url: string): Promise<unknown>;
};
function verifyRuntime(manifest: unknown, runtime: string | null) {
  if (!runtime || !manifest || typeof manifest !== "object" || !("runtimeVersion" in manifest) || manifest.runtimeVersion !== runtime) throw Error("incompatible_update");
}
async function withDeadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("update_timeout")), milliseconds); })]);
  } finally { clearTimeout(timer); }
}
export function createUpdateController(deps: UpdateDependencies) {
  let state: UpdateState = { phase: "idle", release: null, message: "" };
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: UpdateState) => { state = next; listeners.forEach(fn => fn()); };
  const execute = (work: () => Promise<void>) => {
    if (pending) return pending;
    pending = work().catch(error => set({ ...state, phase: "error", message: error instanceof Error && ["unsupported_installation", "unknown_installed_version"].includes(error.message)
      ? "无法确认此安装版本，请联系开发者核对版本信息；没有开始安装。"
      : "更新暂未完成，请稍后重试。当前版本仍可使用。" })).finally(() => { pending = null; });
    return pending;
  };
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    check: () => execute(async () => {
      if (!deps.supported) { set({ phase: "idle", release: null, message: "请在安卓 App 内检查更新；网页版刷新即可使用云端版本。" }); return; }
      if (state.phase === "ready") return;
      set({ phase: "checking", release: null, message: "正在检查云端版本…" });
      // A native release remains discoverable even when the OTA service is unavailable.
      let release: AndroidRelease | null = null;
      try { release = await withDeadline(deps.release(), 15000); } catch { /* OTA remains independently available. */ }
      if (release && needsNativeUpdate(deps.installed, release)) { set({ phase: "native", release, message: `发现新版本 ${release.version}` }); return; }
      const ota = deps.otaEnabled ? await withDeadline(deps.checkOTA(), 30000) : null;
      if (ota?.isAvailable || ota?.isRollBackToEmbedded) {
        if (!ota.isRollBackToEmbedded) verifyRuntime(ota.manifest, deps.installed.runtimeVersion);
        set({ phase: "available", release: null, message: "发现体验更新，无需重新安装 App。" }); return;
      }
      if (!release || !deps.otaEnabled) throw Error("incomplete_update_check");
      set({ phase: "current", release: null, message: "当前已是最新版本。" });
    }),
    download: () => execute(async () => {
      if (state.phase === "native" && state.release) {
        set({ ...state, phase: "downloading", message: "正在核对下载版本…" });
        const current = await withDeadline(deps.release(), 15000);
        if (!needsNativeUpdate(deps.installed, current)) { set({ phase: "idle", release: null, message: "云端版本已变更，请重新检查更新。" }); return; }
        await deps.openURL(current.url);
        set({ phase: "handedOff", release: current, message: "已打开下载页面。下载完成后，在安卓系统提示中确认安装；无需卸载旧 App。" }); return;
      }
      if (state.phase !== "available") return;
      set({ phase: "downloading", release: null, message: "正在下载体验更新…" });
      const update = await withDeadline(deps.fetchOTA(), 120000);
      if (update.isNew && !update.isRollBackToEmbedded) verifyRuntime(update.manifest, deps.installed.runtimeVersion);
      set({ phase: update.isNew || update.isRollBackToEmbedded ? "ready" : "idle", release: null, message: update.isNew || update.isRollBackToEmbedded ? "更新已下载。完成当前输入和发送后，重新打开即可生效。" : "云端版本已变更，请重新检查更新。" });
    }),
    apply: () => execute(async () => { if (state.phase === "ready") await deps.reload(); }),
  };
}
