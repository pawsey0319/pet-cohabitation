import { Directory, File, Paths } from "expo-file-system";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

// Paths contain only our encoded account/scope/reference/version, never a URL.
function location(key: string): File {
  const parts = key.split("/").map(part => encodeURIComponent(part));
  return new File(Paths.cache, "avatar-thumbnails-v1", ...parts.slice(0, -1), `${parts.at(-1)}.png`);
}
export async function readAvatarThumbnail(key: string): Promise<string | null> {
  const file = location(key); return file.exists && file.size > 0 ? file.uri : null;
}
export async function saveAvatarThumbnail(key: string, url: string): Promise<string | null> {
  const destination = location(key);
  if (destination.exists && destination.size > 0) return destination.uri;
  destination.parentDirectory.create({ intermediates: true, idempotent: true });
  const temporary = new File(destination.parentDirectory, `${Date.now()}-${Math.random().toString(36).slice(2)}.download`);
  let resized: File | null = null;
  try {
    await File.downloadFileAsync(url, temporary, { idempotent: true });
    if (temporary.size <= 0 || temporary.size > 12 * 1024 * 1024) throw new Error("avatar_image_invalid");
    const thumbnail = await manipulateAsync(temporary.uri, [{ resize: { width: 192 } }], { format: SaveFormat.PNG });
    resized = new File(thumbnail.uri);
    await resized.copy(destination, { overwrite: true });
    return destination.uri;
  } finally { if (temporary.exists) temporary.delete(); if (resized?.exists) resized.delete(); }
}
export async function deleteAvatarThumbnails(prefix: string): Promise<void> {
  const parts = prefix.split("/").filter(Boolean).map(part => encodeURIComponent(part));
  const directory = new Directory(Paths.cache, "avatar-thumbnails-v1", ...parts);
  if (directory.exists) directory.delete();
}
export async function deleteAvatarThumbnail(key: string): Promise<void> {
  const file = location(key); if (file.exists) file.delete();
}
