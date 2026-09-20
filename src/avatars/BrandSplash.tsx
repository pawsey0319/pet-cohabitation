import { useEffect } from "react";
import { Platform } from "react-native";
import * as SplashScreen from "expo-splash-screen";

// Hold the bundled native brand before the first route appears. `ready` must
// depend only on local session/theme restoration, never model health or network.
if (Platform.OS !== "web") void SplashScreen.preventAutoHideAsync().catch(() => undefined);
export function BrandSplash({ ready }: { ready: boolean }) {
  useEffect(() => {
    if (!ready || Platform.OS === "web") return;
    const frame = requestAnimationFrame(() => { void SplashScreen.hideAsync().catch(() => undefined); });
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  return null;
}
