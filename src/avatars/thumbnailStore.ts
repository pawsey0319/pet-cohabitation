// Web keeps object URLs in memory; never persist signed bearer URLs.
const blobs = new Map<string, string>();
export async function readAvatarThumbnail(key: string): Promise<string | null> { return blobs.get(key) ?? null; }
export async function saveAvatarThumbnail(key: string, url: string): Promise<string | null> {
  if (typeof URL.createObjectURL !== "function") return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error("avatar_download_failed");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/") || blob.size > 12 * 1024 * 1024) throw new Error("avatar_image_invalid");
  const previous = blobs.get(key); const uri = URL.createObjectURL(blob);
  blobs.set(key, uri); if (previous) URL.revokeObjectURL(previous);
  return uri;
}
export async function deleteAvatarThumbnails(prefix: string): Promise<void> {
  for (const [key, uri] of blobs) if (key.startsWith(prefix)) { blobs.delete(key); URL.revokeObjectURL(uri); }
}
export async function deleteAvatarThumbnail(key: string): Promise<void> {
  const uri = blobs.get(key); if (uri) { blobs.delete(key); URL.revokeObjectURL(uri); }
}
