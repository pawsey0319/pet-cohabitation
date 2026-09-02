import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export async function exportJsonFile(data: unknown, filename: string): Promise<void> {
  if (!await Sharing.isAvailableAsync()) throw new Error("当前设备不支持系统分享");
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create({ intermediates: true, overwrite: true });
  file.write(JSON.stringify(data, null, 2));
  await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "导出我的异宠共生数据" });
}
