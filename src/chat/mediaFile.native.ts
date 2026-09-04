import { Directory, File, Paths } from "expo-file-system";

type MediaFileInfo = { size: number; mimeType: string };
type UploadMediaFile = MediaFileInfo & { body: ArrayBuffer };

// Keep uploads out of React Native's Blob/FormData compatibility path.
// expo-file-system reads the local URI directly and Supabase accepts ArrayBuffer.
function localFile(uri: string): File {
  if (!/^(file|content):\/\//i.test(uri)) throw new Error("请选择设备中的图片或录音文件。");
  const file = new File(uri);
  if (!file.exists) throw new Error("媒体文件已无法读取，请重新选择。");
  return file;
}

export async function getMediaInfo(uri: string): Promise<MediaFileInfo> {
  const file = localFile(uri);
  return { size: file.size, mimeType: file.type };
}

export async function readMediaForUpload(uri: string, maxBytes: number): Promise<UploadMediaFile> {
  const file = localFile(uri);
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error("媒体文件为空或已无法读取，请重新选择。");
  if (file.size > maxBytes) throw new Error(`媒体文件不能超过 ${Math.round(maxBytes / 1024 / 1024)} MB`);
  const body = await file.arrayBuffer();
  if (!body.byteLength || body.byteLength > maxBytes) throw new Error("媒体文件大小不符合限制，请重新选择。");
  return { body, size: body.byteLength, mimeType: file.type };
}

export async function stabilizeMediaForOutbox(uri: string, ownerId: string, clientId: string): Promise<string> {
  const source = localFile(uri);
  const directory = new Directory(Paths.document, "pet-cohabitation-outbox", ownerId.replace(/[^a-zA-Z0-9_-]/g, "_"));
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  const extension = source.extension || (source.type.includes("webm") ? ".webm" : ".m4a");
  const destination = new File(directory, `${clientId.replace(/[^a-zA-Z0-9_-]/g, "_")}${extension}`);
  await source.copy(destination, { overwrite: true });
  if (!destination.exists || destination.size <= 0) throw new Error("录音文件保存失败，请重新录制。");
  return destination.uri;
}

export async function removeStabilizedMedia(uri: string): Promise<void> {
  if (!uri.includes("pet-cohabitation-outbox")) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}
