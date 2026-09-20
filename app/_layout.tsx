import { ChatBackgroundProvider } from "../src/backgrounds/ChatBackgroundProvider";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "../src/auth/SessionProvider";
import { NotificationBootstrap } from "../src/notifications/NotificationBootstrap";
import { ThemeProvider, useAppTheme } from "../src/theme/ThemeProvider";
import { BrandSplash } from "../src/avatars/BrandSplash";
export { RouteErrorBoundary as ErrorBoundary } from "../src/ui/RouteErrorBoundary";

function AppStack() {
  const { theme, ready } = useAppTheme();
  const { isLoading } = useSession();
  return <><BrandSplash ready={ready && !isLoading} /><StatusBar style={theme.isDark ? "light" : "dark"} /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.page } }} /></>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <ThemeProvider><ChatBackgroundProvider><NotificationBootstrap /><AppStack /></ChatBackgroundProvider></ThemeProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
