import AsyncStorage from "@react-native-async-storage/async-storage";

// Web and Jest use AsyncStorage. Native bundlers automatically select
// authStorage.native.ts, where authentication secrets use SecureStore.
export const authStorage = AsyncStorage;
