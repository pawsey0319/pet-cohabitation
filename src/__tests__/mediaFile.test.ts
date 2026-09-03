const mockArrayBuffer = jest.fn();
const mockFileState = { exists: true, size: 4, type: "image/png" };
jest.mock("expo-file-system", () => ({
  File: jest.fn().mockImplementation(() => ({ ...mockFileState, arrayBuffer: mockArrayBuffer })),
}));

import { getMediaInfo, readMediaForUpload } from "../chat/mediaFile.native";
// Explicit extension exercises the web implementation, not Jest's native resolution.
const webMedia = require("../chat/mediaFile.ts") as typeof import("../chat/mediaFile");

describe("native media files", () => {
  beforeEach(() => {
    Object.assign(mockFileState, { exists: true, size: 4, type: "image/png" });
    mockArrayBuffer.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer);
  });

  it("uploads local files as ArrayBuffer, not React Native Blob or FormData", async () => {
    const result = await readMediaForUpload("file:///cache/image.png", 1024);
    expect(result.body).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(result.body)]).toEqual([1, 2, 3, 4]);
    expect(result).toMatchObject({ size: 4, mimeType: "image/png" });
  });

  it("gets recording size and type without fetching or reading its bytes", async () => {
    mockFileState.type = "audio/mp4";
    expect(await getMediaInfo("file:///cache/recording.m4a")).toEqual({ size: 4, mimeType: "audio/mp4" });
    expect(mockArrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects missing and remote files", async () => {
    await expect(readMediaForUpload("https://example.test/image.png", 1024)).rejects.toThrow("设备");
    mockFileState.exists = false;
    await expect(readMediaForUpload("file:///cache/gone.png", 1024)).rejects.toThrow("无法读取");
    expect(mockArrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects empty and oversized files before allocating a buffer", async () => {
    mockFileState.size = 0;
    await expect(readMediaForUpload("file:///cache/empty.png", 1024)).rejects.toThrow("为空");
    mockFileState.size = 9 * 1024 * 1024;
    await expect(readMediaForUpload("file:///cache/huge.png", 8 * 1024 * 1024)).rejects.toThrow("8 MB");
    expect(mockArrayBuffer).not.toHaveBeenCalled();
  });

  it("rechecks actual bytes if file size changes while reading", async () => {
    mockArrayBuffer.mockResolvedValue(new ArrayBuffer(2048));
    await expect(readMediaForUpload("content://media/1", 1024)).rejects.toThrow("大小");
  });
});

describe("web media files", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("keeps browser Blob upload and MIME type", async () => {
    const blob = { size: 4, type: "image/png" };
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    expect(await webMedia.readMediaForUpload("blob:test", 1024)).toEqual({ body: blob, size: 4, mimeType: "image/png" });
  });

  it("rejects unreadable URLs and oversized files", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false });
    await expect(webMedia.readMediaForUpload("blob:missing", 1024)).rejects.toThrow("无法读取");
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => ({ size: 9 * 1024 * 1024, type: "image/png" }) });
    await expect(webMedia.readMediaForUpload("blob:large", 8 * 1024 * 1024)).rejects.toThrow("8 MB");
  });
});
