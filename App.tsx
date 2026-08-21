import { AppShell } from "./src/AppShell";
import { AppProvider } from "./src/state/AppState";

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
