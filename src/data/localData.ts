import AsyncStorage from "@react-native-async-storage/async-storage";

/** Export and deletion only include keys with verifiable ownership; shared demo stores are not personal data. */
export async function localDataKeys(ownerId: string): Promise<string[]> {
  const petKey = "pet-cohabitation-local-pet-v2";
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("pet-read-state-v3:") || key.startsWith("pet-desktop-") || key.startsWith("pet-cohabitation") || key.startsWith("pet-chat-background-v1:") || key.startsWith("pet-chat-messages-v1:") || key.startsWith("pet-work-v1:") || key.startsWith("pet-push-") || key.startsWith("pet-private-send-queue-v1:"));
  const legacy = await AsyncStorage.getItem(petKey);
  let ownsLegacy = false;
  try { ownsLegacy = Boolean(legacy && JSON.parse(legacy).pet?.ownerId === ownerId); } catch { /* Corrupt legacy data is not an owned record. */ }
  const ownedPrefixes=[`${petKey}:`,"pet-cohabitation-private-draft:","pet-cohabitation-theme-v1:","pet-cohabitation-notifications-v1:","pet-chat-background-v1:"];
  return keys.filter((key) => {
    if(key.startsWith("pet-read-state-v3:") || key.startsWith("pet-desktop-"))return key.endsWith(`:${ownerId}`);
    if(key.startsWith("pet-cohabitation-portrait-position-v1:"))return key.startsWith(`pet-cohabitation-portrait-position-v1:${encodeURIComponent(ownerId)}:`);
    if(key.startsWith("pet-chat-messages-v1:"))return key.startsWith(`pet-chat-messages-v1:${encodeURIComponent(ownerId)}:`);
    if(key.startsWith("pet-work-v1:") || key.startsWith("pet-push-") || key.startsWith("pet-private-send-queue-v1:"))return key.endsWith(`:${ownerId}`);
    if(key===petKey)return ownsLegacy;
    const prefix=ownedPrefixes.find(value=>key.startsWith(value));
    return prefix ? key===`${prefix}${ownerId}` : false;
  });
}
