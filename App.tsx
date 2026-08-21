import {
  SafeAreaProvider,
  initialWindowMetrics,
  type Metrics,
} from "react-native-safe-area-context";
import { AppShell } from "./src/AppShell";
import { AppProvider } from "./src/state/AppState";

type AppProps = Readonly<{
  initialSafeAreaMetrics?: Metrics | null;
}>;

export default function App({ initialSafeAreaMetrics = initialWindowMetrics }: AppProps) {
  return (
    <SafeAreaProvider initialMetrics={initialSafeAreaMetrics}>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </SafeAreaProvider>
  );
}
