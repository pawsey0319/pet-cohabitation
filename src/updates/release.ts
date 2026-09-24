export const RELEASE_URL = "https://pet-cohabitation-public.vercel.app/releases/android-preview.json";
export const APPLICATION_ID = "com.pawsey.petcohabitation";
// Audited APK metadata travels with the OTA. Publishing a native release also
// updates this allowlist on supported runtimes before changing the cloud manifest.
const APPROVED_APK = {
  path: "/artifacts/eas/Cq3UQrcXE6ADKUHRVNmB2yZj1nx0p7WMGhhRUHObreM.apk",
  sha256: "ba8d6dbe1f1501f2cb7a435c27a6e5d1b53b356262df4d5dda93424bb04650df",
  bytes: 121818258, version: "1.0.9", versionCode: 11, runtimeVersion: "1.0.9",
};
export type AndroidRelease = { version: string; versionCode: number; runtimeVersion: string; url: string; sha256: string; bytes: number; notes: string[]; publishedAt: string };
export type InstalledApp = { version: string | null; versionCode: number | null; runtimeVersion: string | null; channel: string | null; applicationId: string | null };

export function parseRelease(value: unknown): AndroidRelease {
  const manifest = value as Record<string, any> | null;
  const r = manifest?.latest;
  if (manifest?.schemaVersion !== 1 || manifest.platform !== "android" || manifest.channel !== "preview" || manifest.applicationId !== APPLICATION_ID || !r) throw Error("invalid_release");
  if (!/^\d+\.\d+\.\d+$/.test(r.version) || typeof r.runtimeVersion !== "string" || !r.runtimeVersion || !Number.isSafeInteger(r.versionCode) || r.versionCode < 1 || !Number.isSafeInteger(r.bytes) || r.bytes < 1 || r.bytes > 500 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(r.sha256)) throw Error("invalid_release");
  const url = new URL(r.url);
  if (url.origin !== "https://expo.dev" || url.username || url.password || url.search || url.hash || !/^\/artifacts\/eas\/[a-zA-Z0-9_-]+\.apk$/.test(url.pathname)) throw Error("untrusted_release_url");
  if (url.pathname !== APPROVED_APK.path || r.sha256 !== APPROVED_APK.sha256 || r.bytes !== APPROVED_APK.bytes || r.version !== APPROVED_APK.version || r.versionCode !== APPROVED_APK.versionCode || r.runtimeVersion !== APPROVED_APK.runtimeVersion) throw Error("unverified_release");
  if (!Array.isArray(r.notes) || r.notes.length > 10 || r.notes.some((note: unknown) => typeof note !== "string" || note.length > 250) || !Number.isFinite(Date.parse(r.publishedAt))) throw Error("invalid_release");
  return { version: r.version, versionCode: r.versionCode, runtimeVersion: r.runtimeVersion, url: url.href, sha256: r.sha256, bytes: r.bytes, notes: [...r.notes], publishedAt: r.publishedAt };
}

export function needsNativeUpdate(installed: InstalledApp, release: AndroidRelease): boolean {
  if (installed.channel !== "preview" || installed.applicationId !== APPLICATION_ID) throw Error("unsupported_installation");
  if (Number.isSafeInteger(installed.versionCode) && installed.versionCode! > 0) return release.versionCode > installed.versionCode!;
  // Runtime is embedded in the binary; never trust OTA expoConfig.versionCode.
  const current = installed.runtimeVersion;
  if (!current || !/^\d+\.\d+\.\d+$/.test(current)) throw Error("unknown_installed_version");
  const before = current.split(".").map(Number), after = release.version.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (before[i] !== after[i]) return after[i] > before[i];
  return false;
}

export async function fetchRelease(): Promise<AndroidRelease> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(RELEASE_URL, { signal: controller.signal, headers: { Accept: "application/json", "Cache-Control": "no-cache" } });
    if (!response.ok || (response.url && new URL(response.url).origin !== new URL(RELEASE_URL).origin) || !response.headers.get("content-type")?.includes("application/json")) throw Error("release_unavailable");
    const text = await response.text(); if (text.length > 16000) throw Error("invalid_release");
    return parseRelease(JSON.parse(text));
  } finally { clearTimeout(timer); }
}
