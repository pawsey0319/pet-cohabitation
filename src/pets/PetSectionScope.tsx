import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useFocusEffect } from "expo-router";
import type { PetSection } from "../components/PetSectionNav";

export const PetSectionScope = createContext<{ visible: boolean; section: PetSection; navigate: (section: PetSection) => void } | null>(null);
export function usePetSection() { return useContext(PetSectionScope); }
export function usePetSectionFocusEffect(effect: () => void | (() => void)) {
  const visible = usePetSection()?.visible ?? true;
  useFocusEffect(useCallback(() => visible ? effect() : undefined, [visible, effect]));
}
