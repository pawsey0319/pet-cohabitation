import { File } from "expo-file-system";

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
