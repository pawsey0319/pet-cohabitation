import { useContext, useMemo } from "react";
import { StyleSheet } from "react-native";
import { ThemeContext, type AppTheme } from "./ThemeContext";
import { paletteFrom, themeFrom, type ThemeColors } from "./palette";
import { DEFAULT_THEME_PREFERENCES } from "./preferences";

const fallback = themeFrom(DEFAULT_THEME_PREFERENCES);
export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (colors:ThemeColors, theme:AppTheme) => T) {
  return function useThemedStyles() {
    const context = useContext(ThemeContext);
    const theme = context?.theme ?? fallback;
    return useMemo(() => { const colors = paletteFrom(theme); return {styles:StyleSheet.create(factory(colors,theme)),colors,theme}; },[theme]);
  };
}
