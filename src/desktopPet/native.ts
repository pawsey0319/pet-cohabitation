import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import type { DesktopPetStatus } from "./contracts";
export type NativeDesktopPet = {
  status(): Promise<DesktopPetStatus>;
  requestPermission(): Promise<void>;
  start(ownerId: string, petId: string): Promise<void>;
  hide(): Promise<void>; show(): Promise<void>; stop(ownerId: string | null): Promise<void>;
  clearAccount(ownerId: string): Promise<void>; setSize(size: number): Promise<void>;
  pendingCommands(): Promise<string>;
  completeCommand(id: string, ownerId: string, error: string | null): Promise<void>;
  applyImage(ownerId: string, petId: string, url: string, assetVersion: string, name: string): Promise<void>;
  publish(ownerId: string, petId: string, json: string): Promise<void>;
  invalidateImage(ownerId: string, petId: string): Promise<void>;
  addListener(name: "onDesktopPetState", listener: (state: DesktopPetStatus) => void): { remove(): void };
};
export function getDesktopPetModule(): NativeDesktopPet | null {
  return Platform.OS === "android" ? requireOptionalNativeModule<NativeDesktopPet>("PetDesktop") : null;
}
export async function stopDesktopPetForAccount(ownerId: string): Promise<void> {
  const native = getDesktopPetModule();
  // Native removes windows synchronously before returning, including during account switching.
  await native?.stop(ownerId);
  await native?.clearAccount(ownerId);
}
export async function desktopPetKeepsSessionActive(): Promise<boolean> {
  return (await getDesktopPetModule()?.status())?.running === true;
}
