import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../src/auth/SessionProvider";
import { NotificationBootstrap } from "../src/notifications/NotificationBootstrap";
import { ThemeProvider, useAppTheme } from "../src/theme/ThemeProvider";
export { RouteErrorBoundary as ErrorBoundary } from "../src/ui/RouteErrorBoundary";

function AppStack() {
  const { theme } = useAppTheme();
  return <><StatusBar style="light" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.page } }} /></>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <ThemeProvider><NotificationBootstrap /><AppStack /></ThemeProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
