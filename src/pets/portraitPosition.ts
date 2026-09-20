import AsyncStorage from "@react-native-async-storage/async-storage";

export type PortraitPosition = Readonly<{ x: number; y: number; collapsed: boolean }>;
export const DEFAULT_PORTRAIT_POSITION: PortraitPosition = { x: .5, y: .5, collapsed: false };
const prefix = (owner: string) => `pet-cohabitation-portrait-position-v1:${encodeURIComponent(owner)}:`;
export const portraitPositionKey = (owner: string, pet: string) => `${prefix(owner)}${encodeURIComponent(pet)}`;
const writes = new Map<string, Promise<void>>(), epochs = new Map<string, number>();
const unit = (value: number) => Math.max(0, Math.min(1, value));

export function parsePortraitPosition(raw: string | null): PortraitPosition {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (value?.version !== 1 || !Number.isFinite(value.x) || !Number.isFinite(value.y) || typeof value.collapsed !== "boolean") return DEFAULT_PORTRAIT_POSITION;
    return { x: unit(value.x), y: unit(value.y), collapsed: value.collapsed };
  } catch { return DEFAULT_PORTRAIT_POSITION; }
}
export function portraitOffset(position: PortraitPosition, width: number, height: number, size: number) {
  const insetX = Math.min(12, Math.max(0, (width - size) / 2));
  const insetY = Math.min(12, Math.max(0, (height - size) / 2));
  const rangeX = Math.max(0, width - size - insetX * 2), rangeY = Math.max(0, height - size - insetY * 2);
  return { x: insetX + unit(position.x) * rangeX, y: insetY + unit(position.y) * rangeY, insetX, insetY, rangeX, rangeY };
}
export async function loadPortraitPosition(owner: string, pet: string) {
  const key = portraitPositionKey(owner, pet);
  await writes.get(key)?.catch(() => undefined);
  return parsePortraitPosition(await AsyncStorage.getItem(key));
}
export async function savePortraitPosition(owner: string, pet: string, value: PortraitPosition, current: () => boolean) {
  const key = portraitPositionKey(owner, pet), epoch = epochs.get(owner) ?? 0;
  const write = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    if (!current() || (epochs.get(owner) ?? 0) !== epoch) return;
    await AsyncStorage.setItem(key, JSON.stringify({ version: 1, ...value }));
  });
  writes.set(key, write);
  try { await write; } finally { if (writes.get(key) === write) writes.delete(key); }
}
export async function clearPetPortraitPosition(owner: string) {
  epochs.set(owner, (epochs.get(owner) ?? 0) + 1);
  await Promise.allSettled([...writes].filter(([key]) => key.startsWith(prefix(owner))).map(([, write]) => write));
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix(owner)));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
