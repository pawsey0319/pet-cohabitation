export type PetReplyStyle = "concise" | "balanced" | "detailed";
export type AppearanceMode = "light" | "dark" | "system" | "custom";
export type ThemePreferences = Readonly<{
  appearance: AppearanceMode;
  designVersion: 2;
  pageBackground: string;
  cardBackground: string;
  primaryButton: string;
  secondaryButton: string;
  dangerButton: string;
  accent: string;
  cornerStyle: "compact" | "soft" | "round";
  density: "compact" | "comfortable";
  reduceMotion: boolean;
  petReplyStyle: PetReplyStyle;
}>;
export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  appearance: "light", designVersion: 2,
  pageBackground: "#FAFAFA", cardBackground: "#FFFFFF",
  primaryButton: "#A3563C", secondaryButton: "#F0EFED",
  dangerButton: "#B3261E", accent: "#A3563C",
  cornerStyle: "soft", density: "comfortable", reduceMotion: false, petReplyStyle: "concise",
};
export const DARK_THEME_PREFERENCES: ThemePreferences = {
  ...DEFAULT_THEME_PREFERENCES, appearance: "dark",
  pageBackground: "#141312", cardBackground: "#1C1B1A",
  primaryButton: "#C17A5C", secondaryButton: "#292725",
  dangerButton: "#F07167", accent: "#D49478",
};
export const THEME_PRESETS: readonly { id: string; name: string; note: string; value: ThemePreferences }[] = [
  { id:"paper-light", name:"清浅", note:"白灰底色，一点温暖", value:DEFAULT_THEME_PREFERENCES },
  { id:"charcoal-dark", name:"暖夜", note:"柔和深色，安静相伴", value:DARK_THEME_PREFERENCES },
  { id:"follow-system", name:"跟随系统", note:"随设备切换深浅色", value:{...DEFAULT_THEME_PREFERENCES,appearance:"system"} },
];
export function isHexColor(value: string): boolean { return /^#[0-9a-f]{6}$/i.test(value.trim()); }
export function normalizeThemePreferences(value: Partial<ThemePreferences> | null | undefined): ThemePreferences {
  const legacyColors = ["#141329","#211F40","#FF806F","#34305E","#9D4656","#79E0C1"];
  const keys = ["pageBackground","cardBackground","primaryButton","secondaryButton","dangerButton","accent"] as const;
  const hasColors = value && keys.some(key => typeof value[key] === "string");
  const legacyDefault = !value?.designVersion && hasColors && keys.every((key,i) => !value?.[key] || value[key]!.toUpperCase() === legacyColors[i]);
  const appearance: AppearanceMode = value?.appearance === "dark" || value?.appearance === "system" || value?.appearance === "custom" || value?.appearance === "light" ? value.appearance : hasColors && !legacyDefault ? "custom" : "light";
  const defaults = appearance === "dark" ? DARK_THEME_PREFERENCES : DEFAULT_THEME_PREFERENCES;
  const color = (key: typeof keys[number]) => !legacyDefault && typeof value?.[key] === "string" && isHexColor(value[key]!) ? value[key]!.trim().toUpperCase() : defaults[key];
  return {
    appearance, designVersion:2,
    pageBackground:color("pageBackground"),cardBackground:color("cardBackground"),primaryButton:color("primaryButton"),secondaryButton:color("secondaryButton"),dangerButton:color("dangerButton"),accent:color("accent"),
    cornerStyle:value?.cornerStyle === "compact" || value?.cornerStyle === "round" ? value.cornerStyle : "soft",
    density:value?.density === "compact" ? "compact" : "comfortable",
    reduceMotion:value?.reduceMotion === true,
    petReplyStyle:value?.petReplyStyle === "balanced" || value?.petReplyStyle === "detailed" ? value.petReplyStyle : "concise",
  };
}