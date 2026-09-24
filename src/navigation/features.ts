export const PET_FEATURES = {
  companion: { title: "陪伴", href: "/pet" },
  memory: { title: "记忆", href: "/pet-memory" },
  growth: { title: "成长", href: "/pet-growth" },
  desktop: { title: "桌宠", href: "/pet-desktop" },
  personality: { title: "性格变化", href: "/pet-personality" },
  relationships: { title: "群关系理解", href: "/pet-relations" },
  settings: { title: "相处设置", href: "/pet-settings" },
} as const;
export type PetFeature = keyof typeof PET_FEATURES;
export function legacyPetDestination(value: unknown): string | null {
  if (value === "steward" || value === "companion") return PET_FEATURES.companion.href;
  if (value === "growth") return PET_FEATURES.growth.href;
  if (value === "memory") return PET_FEATURES.memory.href;
  if (value === "reply") return PET_FEATURES.settings.href;
  return null;
}
