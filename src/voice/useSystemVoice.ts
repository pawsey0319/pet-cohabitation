import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, PermissionsAndroid, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSession } from "../auth/SessionProvider";
import { createRequestId } from "../lib/uuid";
import { getVoiceModule, voiceError, type VoiceCapabilities, type VoiceEvent } from "./native";

export function useSystemVoice({ scopeKey, onTranscript, language = "zh-CN" }: { scopeKey: string; onTranscript?(text: string): void; language?: string }) {
  const { profile } = useSession(); const scope = `${profile?.id ?? "guest"}:${scopeKey}:`;
  const module = useRef(getVoiceModule()).current; const owner = useRef(scope); owner.current = scope;
  const finalText = useRef(onTranscript); finalText.current = onTranscript;
  const focused = useRef(true); const sequence = useRef(0); const session = useRef<string | null>(null);
  const [capabilities, setCapabilities] = useState<VoiceCapabilities | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "listening" | "processing" | "speaking">("idle");
  const [partial, setPartial] = useState(""); const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"on_device" | "system" | null>(null); const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const stop = useCallback(async () => { sequence.current++; session.current = null; setStatus("idle"); setPartial(""); setSpeakingMessageId(null); try { await module?.stop(scope); } catch { /* Native teardown may already have completed. Local callbacks remain fenced. */ } }, [module, scope]);
  useFocusEffect(useCallback(() => { focused.current = true; return () => { focused.current = false; void stop(); }; }, [stop]));
  useEffect(() => {
    let active = true; setCapabilities(null); setError(null); setStatus("idle");
    if (!module) return;
    void module.capabilities(language).then(value => { if (active) setCapabilities(value); }).catch(() => { if (active) setError(voiceError()); });
    const accept = (event: VoiceEvent) => active && focused.current && owner.current === scope && event.sessionId === session.current;
    const listeners = [
      module.addListener("onTranscript", event => {
        if (!accept(event)) return;
        if (event.final) { session.current = null; setStatus("idle"); setPartial(""); if (event.text?.trim()) finalText.current?.(event.text.trim()); }
        else setPartial(event.text ?? "");
      }),
      module.addListener("onVoiceState", event => { if (accept(event)) { if (event.state) setStatus(event.state); if (event.mode) setMode(event.mode); if (event.state === "idle") setSpeakingMessageId(null); } }),
      module.addListener("onVoiceError", event => { if (accept(event)) { session.current = null; setError(voiceError(event.code)); setStatus("idle"); setPartial(""); setSpeakingMessageId(null); } }),
    ];
    const appState = AppState.addEventListener("change", state => { if (state !== "active") void stop(); });
    return () => { active = false; sequence.current++; session.current = null; listeners.forEach(listener => listener.remove()); appState.remove(); void module.stop(scope).catch(() => undefined); };
  }, [module, scope, language, stop]);
  const listen = async () => {
    if (!module || !capabilities?.recognition || Platform.OS !== "android") { setError(voiceError()); return; }
    const token = ++sequence.current; setError(null); setPartial(""); setStatus("starting");
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (token !== sequence.current || owner.current !== scope || !focused.current) return;
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) { setError(voiceError("microphone_denied")); setStatus("idle"); return; }
    const id = `${scope}${createRequestId()}`; session.current = id; setSpeakingMessageId(null);
    try { await module.startRecognition(id, language); } catch (reason) { if (token === sequence.current) { setError(voiceError((reason as { code?: string })?.code)); setStatus("idle"); } }
  };
  const finish = async () => { if (session.current) await module?.finishRecognition(session.current); };
  const speak = async (messageId: string, text: string) => {
    if (!module || !capabilities?.speech) { setError(voiceError("speech_unavailable")); return; }
    const id = `${scope}${createRequestId()}`; const token = ++sequence.current; session.current = id; setError(null); setPartial(""); setSpeakingMessageId(messageId);
    try { await module.speak(id, text, language); } catch (reason) { if (token === sequence.current) { setError(voiceError((reason as { code?: string })?.code)); setStatus("idle"); setSpeakingMessageId(null); } }
  };
  return { capabilities, status, partial, error, mode, speakingMessageId, listen, finish, speak, stop, supported: !!module };
}
