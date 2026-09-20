import type { AppTheme } from "./ThemeContext";
import { DARK_THEME_PREFERENCES, DEFAULT_THEME_PREFERENCES, type ThemePreferences } from "./preferences";

export function luminance(hex: string): number {
  const rgb = hex.replace("#", "").match(/.{2}/g);
  if (!rgb || rgb.length !== 3) return 0;
  const [r,g,b] = rgb.map(c => { const v = parseInt(c,16)/255; return v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4; });
  return .2126*r + .7152*g + .0722*b;
}
export function readableInk(background: string): string { return luminance(background) > .179 ? "#171310" : "#FFFFFF"; }

export function themeFrom(preferences: ThemePreferences, systemDark = false): AppTheme {
  const source = preferences.appearance === "custom" ? preferences : preferences.appearance === "dark" || preferences.appearance === "system" && systemDark ? DARK_THEME_PREFERENCES : DEFAULT_THEME_PREFERENCES;
  const isDark = luminance(source.pageBackground) < .15;
  return {
    isDark,page:source.pageBackground,card:source.cardBackground,cardSoft:source.secondaryButton,
    primary:source.primaryButton,secondary:source.secondaryButton,danger:source.dangerButton,accent:source.accent,
    text:isDark?"#F0EEEB":"#111111",muted:isDark?"#A3A09A":"#6B6B6B",line:isDark?"#383532":"#E5E5E5",
    radius:preferences.cornerStyle === "compact" ? 8 : preferences.cornerStyle === "round" ? 18 : 12,
    controlHeight:preferences.density === "compact" ? 48 : 52,onPrimary:readableInk(source.primaryButton),onDanger:readableInk(source.dangerButton),
    userBubble:isDark?"#49372E":"#F3E8E3",userText:isDark?"#F5EEE9":"#241B16",overlay:isDark?"rgba(0,0,0,.66)":"rgba(20,19,18,.38)",
  };
}
export function paletteFrom(theme: AppTheme) {
  return {
    canvas:theme.page,canvasRaised:theme.card,surface:theme.cardSoft,surfaceSoft:theme.secondary,
    lavender:theme.accent,lavenderSoft:theme.text,coral:theme.primary,coralSoft:theme.userBubble,
    mint:theme.accent,mintDeep:theme.card,white:theme.onPrimary,text:theme.text,textMuted:theme.muted,textDark:theme.userText,
    line:theme.line,shadow:theme.isDark?"#000000":"#2A211C",
  };
}
export type ThemeColors = ReturnType<typeof paletteFrom>;
