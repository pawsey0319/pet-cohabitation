export type MediaFileInfo = { size: number; mimeType: string };
export type UploadMediaFile = MediaFileInfo & { body: Blob | ArrayBuffer };

export function validateMediaSize(size: number, maxBytes: number): void {
  if (!Number.isFinite(size) || size <= 0) throw new Error("媒体文件为空或已无法读取，请重新选择。");
  if (size > maxBytes) throw new Error(`媒体文件不能超过 ${Math.round(maxBytes / 1024 / 1024)} MB`);
}

export async function getMediaInfo(uri: string): Promise<MediaFileInfo> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("媒体文件无法读取，请重新选择。");
  const blob = await response.blob();
  return { size: blob.size, mimeType: blob.type };
}

export async function readMediaForUpload(uri: string, maxBytes: number): Promise<UploadMediaFile> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("媒体文件无法读取，请重新选择。");
  const body = await response.blob();
  validateMediaSize(body.size, maxBytes);
  return { body, size: body.size, mimeType: body.type };
}
