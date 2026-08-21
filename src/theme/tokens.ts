export const colors = {
  canvas: "#17152F",
  canvasRaised: "#201D3D",
  surface: "#2A2650",
  surfaceSoft: "#342F5E",
  lavender: "#BEB8F8",
  lavenderSoft: "#E6E1FF",
  coral: "#FF806F",
  coralSoft: "#FFD0C9",
  mint: "#7DE2C4",
  mintDeep: "#173F3A",
  white: "#FFFFFF",
  text: "#F7F4FF",
  textMuted: "#B7B1D3",
  textDark: "#25213F",
  line: "rgba(230, 225, 255, 0.14)",
  shadow: "#090817",
} as const;
export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
  xxl: 40,
} as const;

export const radii = {
  sm: 12,
  md: 18,
  lg: 26,
  xl: 34,
  pill: 999,
} as const;

export const typography = {
  eyebrow: 12,
  body: 15,
  bodyLarge: 17,
  title: 24,
  display: 34,
} as const;

export const shadows = {
  card: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.24,
    shadowRadius: 28,
    elevation: 8,
  },
} as const;
