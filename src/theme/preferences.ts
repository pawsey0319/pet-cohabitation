export type PetReplyStyle = "concise" | "balanced" | "detailed";

export type ThemePreferences = Readonly<{
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
  pageBackground: "#141329",
  cardBackground: "#211F40",
  primaryButton: "#FF806F",
  secondaryButton: "#34305E",
  dangerButton: "#9D4656",
  accent: "#79E0C1",
  cornerStyle: "soft",
  density: "comfortable",
  reduceMotion: false,
  petReplyStyle: "concise",
};

export const THEME_PRESETS: readonly { id: string; name: string; note: string; value: ThemePreferences }[] = [
  { id: "night-coral", name: "暮夜珊瑚", note: "克制、温暖，适合长时间聊天", value: DEFAULT_THEME_PREFERENCES },
  { id: "mist-mint", name: "雾海薄荷", note: "低饱和青色，更安静清爽", value: { ...DEFAULT_THEME_PREFERENCES, pageBackground: "#102323", cardBackground: "#173533", primaryButton: "#53C9A7", secondaryButton: "#254B48", dangerButton: "#98525C", accent: "#B6F2DE" } },
  { id: "paper-moon", name: "纸月灰紫", note: "柔和灰紫，信息层级更明显", value: { ...DEFAULT_THEME_PREFERENCES, pageBackground: "#22202A", cardBackground: "#302D3B", primaryButton: "#B887F4", secondaryButton: "#474153", dangerButton: "#A75362", accent: "#F4C77A" } },
];

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

export function normalizeThemePreferences(value: Partial<ThemePreferences> | null | undefined): ThemePreferences {
  const color = (candidate: unknown, fallback: string) => typeof candidate === "string" && isHexColor(candidate) ? candidate.toUpperCase() : fallback;
  return {
    pageBackground: color(value?.pageBackground, DEFAULT_THEME_PREFERENCES.pageBackground),
    cardBackground: color(value?.cardBackground, DEFAULT_THEME_PREFERENCES.cardBackground),
    primaryButton: color(value?.primaryButton, DEFAULT_THEME_PREFERENCES.primaryButton),
    secondaryButton: color(value?.secondaryButton, DEFAULT_THEME_PREFERENCES.secondaryButton),
    dangerButton: color(value?.dangerButton, DEFAULT_THEME_PREFERENCES.dangerButton),
    accent: color(value?.accent, DEFAULT_THEME_PREFERENCES.accent),
    cornerStyle: value?.cornerStyle === "compact" || value?.cornerStyle === "round" ? value.cornerStyle : "soft",
    density: value?.density === "compact" ? "compact" : "comfortable",
    reduceMotion: value?.reduceMotion === true,
    petReplyStyle: value?.petReplyStyle === "balanced" || value?.petReplyStyle === "detailed" ? value.petReplyStyle : "concise",
  };
}

