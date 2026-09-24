import { AppRegistry, Platform } from "react-native";

// Import from the application entry BEFORE expo-router/entry, not from a mounted screen.
// Android's HeadlessJsTaskService reuses the application's ReactHost, secure auth storage
// and Supabase singleton. No Activity, duplicate client, token copies or custom refresh loop.
if (Platform.OS === "android") {
  AppRegistry.registerHeadlessTask("PetDesktopRuntime", () => async () => {
    const { runDesktopPetCommands } = await import("./runtime");
    await runDesktopPetCommands();
  });
}
