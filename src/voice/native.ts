import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
export type VoiceCapabilities = { recognition: boolean; onDevice: boolean; speech: boolean };
export type VoiceEvent = { sessionId: string; text?: string; final?: boolean; state?: "idle" | "listening" | "processing" | "speaking"; mode?: "on_device" | "system"; code?: string };
export type NativeVoice = {
  capabilities(language: string): Promise<VoiceCapabilities>;
  startRecognition(sessionId: string, language: string): Promise<void>;
  finishRecognition(sessionId: string): Promise<void>;
  speak(sessionId: string, text: string, language: string): Promise<void>;
  stop(scopeId: string | null): Promise<void>;
  addListener(event: "onTranscript" | "onVoiceState" | "onVoiceError", callback: (event: VoiceEvent) => void): { remove(): void };
};
export function getVoiceModule(): NativeVoice | null {
  return Platform.OS === "android" ? requireOptionalNativeModule<NativeVoice>("PetSystemVoice") : null;
}
export async function stopSystemVoice(): Promise<void> { await getVoiceModule()?.stop(null); }
export function voiceError(code?: string): string {
  if (code === "microphone_denied") return "需要麦克风权限才能语音输入，也可以继续打字。";
  if (code === "no_speech") return "没有听清，点击后再说一次。";
  if (code === "recognition_network_error") return "系统识别服务连接失败，可以继续打字。";
  if (code?.includes("language")) return "系统语音引擎暂不支持该语言，请检查手机语音设置。";
  if (code?.includes("speech")) return "系统朗读暂不可用，请检查手机语音引擎。";
  return "这台设备暂不支持语音输入，可以继续打字。";
}
