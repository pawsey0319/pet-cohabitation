import { PetWorkspaceProvider } from "../src/pets/PetWorkspaceProvider";
import { ChatRuntimeBootstrap } from "../src/chat/ChatRuntimeBootstrap";
import { ChatBackgroundProvider } from "../src/backgrounds/ChatBackgroundProvider";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "../src/auth/SessionProvider";
import { NotificationBootstrap } from "../src/notifications/NotificationBootstrap";
import { ThemeProvider, useAppTheme } from "../src/theme/ThemeProvider";
import { BrandSplash } from "../src/avatars/BrandSplash";
import { AppUpdateNotice } from "../src/updates/AppUpdates";
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
        <PetWorkspaceProvider><ThemeProvider><ChatBackgroundProvider><NotificationBootstrap /><ChatRuntimeBootstrap /><AppStack /><AppUpdateNotice /></ChatBackgroundProvider></ThemeProvider></PetWorkspaceProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
