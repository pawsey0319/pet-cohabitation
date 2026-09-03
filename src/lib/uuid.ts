import { uuid } from "expo-modules-core";

// Expo uses its native UUID implementation on Android/iOS and Web Crypto on Web.
// Do not call the browser-only global crypto from shared application code.
export function createRequestId(): string {
  return uuid.v4();
}
