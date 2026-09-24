import AsyncStorage from "@react-native-async-storage/async-storage";

/** Legacy demo stores are browser-wide; personal pet records are owner-scoped. */
export async function localDataKeys(ownerId: string): Promise<string[]> {
  const petKey = "pet-cohabitation-local-pet-v2";
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("pet-cohabitation"));
  const legacy = await AsyncStorage.getItem(petKey);
  let ownsLegacy = false;
  try { ownsLegacy = Boolean(legacy && JSON.parse(legacy).pet?.ownerId === ownerId); } catch { /* Corrupt legacy data is not an owned record. */ }
  return keys.filter((key) => key === petKey ? ownsLegacy : key.startsWith(`${petKey}:`) ? key === `${petKey}:${ownerId}` : key.startsWith("pet-cohabitation-private-draft:") ? key === `pet-cohabitation-private-draft:${ownerId}` : true);
}
