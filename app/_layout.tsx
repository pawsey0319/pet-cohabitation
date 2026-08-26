import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../src/auth/SessionProvider";
import { ThemeProvider, useAppTheme } from "../src/theme/ThemeProvider";

function AppStack() {
  const { theme } = useAppTheme();
  return <><StatusBar style="light" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.page } }} /></>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <ThemeProvider><AppStack /></ThemeProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
