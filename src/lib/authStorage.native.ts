import * as SecureStore from "expo-secure-store";

const CHUNK_SIZE = 1800;
const manifestKey = (key: string) => `${key}:manifest`;
const chunkKey = (key: string, index: number) => `${key}:chunk:${index}`;

async function storedChunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(manifestKey(key));
  const count = Number(raw);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = await storedChunkCount(key);
    if (!count) return SecureStore.getItemAsync(key);
    const chunks = await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(key, index))));
    return chunks.every((chunk) => chunk !== null) ? chunks.join("") : null;
  },

  async setItem(key: string, value: string): Promise<void> {
    const previousCount = await storedChunkCount(key);
    const chunks = Array.from({ length: Math.ceil(value.length / CHUNK_SIZE) }, (_, index) => value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE));
    await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk)));
    await SecureStore.setItemAsync(manifestKey(key), String(chunks.length));
    await SecureStore.deleteItemAsync(key);
    if (previousCount > chunks.length) {
      await Promise.all(Array.from({ length: previousCount - chunks.length }, (_, index) => SecureStore.deleteItemAsync(chunkKey(key, chunks.length + index))));
    }
  },

  async removeItem(key: string): Promise<void> {
    const count = await storedChunkCount(key);
    await Promise.all([
      SecureStore.deleteItemAsync(key),
      SecureStore.deleteItemAsync(manifestKey(key)),
      ...Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(chunkKey(key, index))),
    ]);
  },
};
