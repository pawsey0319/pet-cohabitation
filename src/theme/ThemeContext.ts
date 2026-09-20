import { createContext } from "react";
import type { ThemePreferences } from "./preferences";

export type AppTheme = Readonly<{
  isDark: boolean;
  page: string;
  card: string;
  cardSoft: string;
  primary: string;
  secondary: string;
  danger: string;
  accent: string;
  text: string;
  muted: string;
  line: string;
  radius: number;
  controlHeight: number;
  onPrimary: string;
  onDanger: string;
  userBubble: string;
  userText: string;
  overlay: string;
}>;

export type ThemeContextValue = Readonly<{
  preferences: ThemePreferences;
  theme: AppTheme;
  ready: boolean;
  dirty: boolean;
  saving: boolean;
  update(patch: Partial<ThemePreferences>): void;
  replace(value: ThemePreferences): void;
  save(): Promise<void>;
  reset(): void;
}>;

export const ThemeContext = createContext<ThemeContextValue | null>(null);
