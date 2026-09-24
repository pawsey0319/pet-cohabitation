import { createUpdateController, type UpdateDependencies } from "../controller";
import { APPLICATION_ID, needsNativeUpdate, parseRelease, type InstalledApp } from "../release";
import manifest from "../../../public/releases/android-preview.json";

const release = parseRelease(manifest);
const installed: InstalledApp = { applicationId: APPLICATION_ID, channel: "preview", version: release.version, versionCode: release.versionCode, runtimeVersion: release.runtimeVersion };
function setup(overrides: Partial<UpdateDependencies> = {}) {
  const deps: UpdateDependencies = { installed, supported: true, otaEnabled: true, release: jest.fn().mockResolvedValue(release), checkOTA: jest.fn().mockResolvedValue({ isAvailable: false }), fetchOTA: jest.fn().mockResolvedValue({ isNew: true, manifest: { runtimeVersion: installed.runtimeVersion } }), reload: jest.fn().mockResolvedValue(undefined), openURL: jest.fn().mockResolvedValue(undefined), ...overrides };
  return { deps, controller: createUpdateController(deps) };
}
test("release rejects wrong app/channel, unsafe URLs and malformed metadata", () => {
  const inputs = [ { ...manifest, applicationId: "foreign" }, { ...manifest, channel: "production" }, ...["http://expo.dev/artifacts/eas/a.apk", "https://expo.dev.attacker.test/artifacts/eas/a.apk", "https://expo.dev/@pawsey/project", "https://expo.dev/artifacts/eas/a.apk?redirect=other"].map(url => ({ ...manifest, latest: { ...release, url } })), { ...manifest, latest: { ...release, versionCode: 0 } }, { ...manifest, latest: { ...release, sha256: "wrong" } } ];
  for (const input of inputs) expect(() => parseRelease(input)).toThrow();
});
test("uses binary build number and prevents same-version or downgrade installs", () => {
  expect(needsNativeUpdate({ ...installed, versionCode: 8 }, release)).toBe(true);
  expect(needsNativeUpdate(installed, release)).toBe(false);
  expect(needsNativeUpdate({ ...installed, versionCode: release.versionCode + 1 }, release)).toBe(false);
  expect(needsNativeUpdate({ ...installed, versionCode: null, runtimeVersion: "1.0.7" }, release)).toBe(true);
  expect(() => needsNativeUpdate({ ...installed, versionCode: null, runtimeVersion: null }, release)).toThrow();
});

test("a different EAS artifact is rejected even on the official host", () => {
  expect(() => parseRelease({ ...manifest, latest: { ...release, url: "https://expo.dev/artifacts/eas/another.apk" } })).toThrow("unverified_release");
  expect(() => parseRelease({ ...manifest, latest: { ...release, sha256: "a".repeat(64) } })).toThrow("unverified_release");
});

test.each([undefined, {}, { runtimeVersion: null }])("OTA without a matching runtime is not offered: %p", async incomplete => {
  const { controller } = setup({ checkOTA: jest.fn().mockResolvedValue({ isAvailable: true, manifest: incomplete }) });
  await controller.check(); expect(controller.getSnapshot().phase).toBe("error");
});

test("native SDK rollback can download without a manifest and still requires explicit apply", async () => {
  const { controller, deps } = setup({ checkOTA: jest.fn().mockResolvedValue({ isAvailable: false, isRollBackToEmbedded: true }), fetchOTA: jest.fn().mockResolvedValue({ isNew: false, isRollBackToEmbedded: true }) });
  await controller.check(); await controller.download(); expect(controller.getSnapshot().phase).toBe("ready"); expect(deps.reload).not.toHaveBeenCalled();
});

test("a downloaded OTA with missing runtime cannot be applied", async () => {
  const { controller, deps } = setup({ checkOTA: jest.fn().mockResolvedValue({ isAvailable: true, manifest: { runtimeVersion: installed.runtimeVersion } }), fetchOTA: jest.fn().mockResolvedValue({ isNew: true }) });
  await controller.check(); await controller.download(); await controller.apply();
  expect(controller.getSnapshot().phase).toBe("error"); expect(deps.reload).not.toHaveBeenCalled();
});

test("unknown legacy native version explains the problem without starting installation", async () => {
  const { controller, deps } = setup({ installed: { ...installed, versionCode: null, runtimeVersion: "unknown-fingerprint" } });
  await controller.check();
  expect(controller.getSnapshot().message).toContain("无法确认此安装版本");
  expect(deps.openURL).not.toHaveBeenCalled();
});
test("native upgrade does not wait for an unavailable OTA provider", async () => {
  const { controller, deps } = setup({ installed: { ...installed, versionCode: 8, runtimeVersion: "1.0.7" }, checkOTA: jest.fn(() => new Promise(() => {})) });
  await controller.check(); expect(controller.getSnapshot().phase).toBe("native"); expect(deps.checkOTA).not.toHaveBeenCalled();
  await controller.download(); expect(deps.openURL).toHaveBeenCalledWith(release.url); expect(controller.getSnapshot().phase).toBe("handedOff"); expect(deps.reload).not.toHaveBeenCalled();
});
test("revalidates a withdrawn native release before opening a download", async () => {
  const { controller, deps } = setup({ installed: { ...installed, versionCode: 8 }, release: jest.fn().mockResolvedValueOnce(release).mockResolvedValueOnce({ ...release, versionCode: 8 }) });
  await controller.check(); await controller.download(); expect(deps.openURL).not.toHaveBeenCalled(); expect(controller.getSnapshot().phase).toBe("idle");
});
test("OTA downloads without a native reinstall and reloads only on explicit apply", async () => {
  const { controller, deps } = setup({ checkOTA: jest.fn().mockResolvedValue({ isAvailable: true, manifest: { runtimeVersion: installed.runtimeVersion } }) });
  await controller.check(); expect(controller.getSnapshot().phase).toBe("available"); await controller.download(); expect(controller.getSnapshot().phase).toBe("ready");
  expect(deps.reload).not.toHaveBeenCalled(); expect(deps.openURL).not.toHaveBeenCalled(); await controller.apply(); expect(deps.reload).toHaveBeenCalledTimes(1);
});
test("incompatible OTA is rejected without download or reload", async () => {
  const { controller, deps } = setup({ checkOTA: jest.fn().mockResolvedValue({ isAvailable: true, manifest: { runtimeVersion: "9.0.0" } }) });
  await controller.check(); expect(controller.getSnapshot().phase).toBe("error"); await controller.download(); await controller.apply(); expect(deps.fetchOTA).not.toHaveBeenCalled(); expect(deps.reload).not.toHaveBeenCalled();
});
test("failed checks never claim latest and failed downloads remain retryable", async () => {
  const first = setup({ release: jest.fn().mockRejectedValue(Error("offline")) });
  await first.controller.check(); expect(first.controller.getSnapshot().phase).toBe("error");
  const second = setup({ installed: { ...installed, versionCode: 8 }, openURL: jest.fn().mockRejectedValue(Error("unavailable")) });
  await second.controller.check(); await second.controller.download(); expect(second.controller.getSnapshot().phase).toBe("error"); await second.controller.check(); expect(second.controller.getSnapshot().phase).toBe("native");
});
test("overlapping checks and taps reuse the same in-flight operation", async () => {
  let resolve!: (value: typeof release) => void;
  const { controller, deps } = setup({ release: jest.fn(() => new Promise(done => { resolve = done; })) });
  const one = controller.check(), two = controller.check(); expect(one).toBe(two); resolve(release); await one; expect(deps.release).toHaveBeenCalledTimes(1);
});

test("a stalled OTA check times out and late results cannot replace a later check", async () => {
  jest.useFakeTimers();
  try {
    let late!: (value: { isAvailable: boolean }) => void;
    const { controller } = setup({ checkOTA: jest.fn().mockImplementationOnce(() => new Promise(done => { late = done; })).mockResolvedValueOnce({ isAvailable: false }) });
    const checking = controller.check();
    await jest.advanceTimersByTimeAsync(30001);
    await checking;
    expect(controller.getSnapshot().phase).toBe("error");
    await controller.check();
    expect(controller.getSnapshot().phase).toBe("current");
    late({ isAvailable: true });
    await Promise.resolve();
    expect(controller.getSnapshot().phase).toBe("current");
  } finally { jest.useRealTimers(); }
});
