export async function exportJsonFile(data: unknown, filename: string): Promise<void> {
  if (typeof document === "undefined") throw new Error("当前环境不支持文件导出");
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
