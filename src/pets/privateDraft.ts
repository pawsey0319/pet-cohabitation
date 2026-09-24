import AsyncStorage from "@react-native-async-storage/async-storage";
export type PendingPrivateDraft = Readonly<{ content: string; id: string }>;
const key=(ownerId:string)=>`pet-cohabitation-private-draft:${ownerId}`;
export async function loadPrivateDraft(ownerId:string):Promise<PendingPrivateDraft|null>{
  const raw=await AsyncStorage.getItem(key(ownerId));
  try{const value=raw?JSON.parse(raw):null;return value&&typeof value.id==="string"&&typeof value.content==="string"?value:null;}catch{return null;}
}
export async function savePrivateDraft(ownerId:string,value:PendingPrivateDraft|null):Promise<void>{
  if(value)await AsyncStorage.setItem(key(ownerId),JSON.stringify(value));else await AsyncStorage.removeItem(key(ownerId));
}
