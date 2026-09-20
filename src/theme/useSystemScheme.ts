import { useEffect } from "react";
import { Appearance, useColorScheme } from "react-native";
export function useSystemScheme() {
  const scheme=useColorScheme();
  // The existing 1.0.4 shell was configured dark. The bundled RN API can release
  // that app override without adding a native dependency or rebuilding the APK.
  useEffect(()=>{Appearance.setColorScheme("unspecified");},[]);
  return scheme;
}
