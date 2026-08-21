import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import type { UserPet } from "../domain/types";
import type { EvolutionVisualTrait } from "../domain/evolution";
import { colors } from "../theme/tokens";

type PetAvatarProps = Readonly<{
  pet: UserPet;
  size?: number;
}>;

function coreColor(anchor: string): string {
  if (anchor.includes("珊瑚") || anchor.toLowerCase().includes("coral")) {
    return colors.coral;
  }
  if (anchor.includes("薄荷") || anchor.toLowerCase().includes("mint")) {
    return colors.mint;
  }
  return colors.lavender;
}

type TraitMarkKind =
  | "soft-fringe"
  | "heart-emblem"
  | "focus-star"
  | "tool-charm"
  | "welcome-dots"
  | "friend-ribbon"
  | "shared-steps"
  | "resonance-bell";

const EVOLUTION_TRAIT_MARKS = {
  柔光绒边: "soft-fringe",
  暖心徽记: "heart-emblem",
  专注星纹: "focus-star",
  工具小挂饰: "tool-charm",
  迎宾光点: "welcome-dots",
  友伴缎带: "friend-ribbon",
  同游足迹: "shared-steps",
  共鸣铃铛: "resonance-bell",
} satisfies Readonly<Record<EvolutionVisualTrait, TraitMarkKind>>;

function isEvolutionVisualTrait(trait: string): trait is EvolutionVisualTrait {
  return Object.prototype.hasOwnProperty.call(EVOLUTION_TRAIT_MARKS, trait);
}

function EvolutionTraitMark({ trait }: Readonly<{ trait: EvolutionVisualTrait }>) {
  const label = `成长印记：${trait}`;

  switch (EVOLUTION_TRAIT_MARKS[trait]) {
    case "soft-fringe":
      return (
        <G accessibilityLabel={label} fill="none" stroke={colors.lavenderSoft} strokeWidth="4">
          <Path d="M48 132 Q55 142 62 133 Q70 144 78 134 Q87 144 95 133 Q103 142 112 132" />
        </G>
      );
    case "heart-emblem":
      return (
        <G accessibilityLabel={label}>
          <Path d="M80 64 C68 54 58 68 80 84 C102 68 92 54 80 64 Z" fill={colors.coralSoft} />
        </G>
      );
    case "focus-star":
      return (
        <G accessibilityLabel={label}>
          <Path d="M118 60 L122 69 L132 70 L124 77 L126 87 L118 82 L109 87 L112 77 L104 70 L114 69 Z" fill={colors.mint} />
        </G>
      );
    case "tool-charm":
      return (
        <G accessibilityLabel={label} stroke={colors.textDark} strokeWidth="3" strokeLinecap="round">
          <Path d="M119 103 L132 116" />
          <Rect x="126" y="112" width="10" height="13" rx="3" fill={colors.lavenderSoft} />
        </G>
      );
    case "welcome-dots":
      return (
        <G accessibilityLabel={label} fill={colors.mint}>
          <Circle cx="29" cy="73" r="4" />
          <Circle cx="23" cy="84" r="3" />
          <Circle cx="29" cy="95" r="4" />
        </G>
      );
    case "friend-ribbon":
      return (
        <G accessibilityLabel={label} fill="none" stroke={colors.coralSoft} strokeWidth="5" strokeLinecap="round">
          <Path d="M105 45 C116 35 128 40 123 52 C119 60 108 56 105 45 Z" />
          <Path d="M121 53 L132 63" />
        </G>
      );
    case "shared-steps":
      return (
        <G accessibilityLabel={label} fill={colors.lavenderSoft} opacity={0.9}>
          <Ellipse cx="57" cy="126" rx="5" ry="8" transform="rotate(-22 57 126)" />
          <Ellipse cx="72" cy="134" rx="5" ry="8" transform="rotate(18 72 134)" />
        </G>
      );
    case "resonance-bell":
      return (
        <G accessibilityLabel={label}>
          <Path d="M31 102 C31 91 45 91 45 102 L49 112 L27 112 Z" fill={colors.mint} />
          <Circle cx="38" cy="116" r="3" fill={colors.coralSoft} />
        </G>
      );
  }
}

const FALLBACK_SLOTS = [
  { x: 23, y: 52 },
  { x: 136, y: 66 },
  { x: 126, y: 130 },
  { x: 34, y: 130 },
] as const;

function fallbackTraitSlot(trait: string): number {
  return Array.from(trait).reduce((total, character) => total + character.charCodeAt(0), 0) %
    FALLBACK_SLOTS.length;
}

function isInitialTraitMark(trait: string): boolean {
  return trait.includes("倾听") || trait.includes("游戏") || trait.includes("组织");
}

function FallbackTraitMark({ trait }: Readonly<{ trait: string }>) {
  const slot = fallbackTraitSlot(trait);
  const { x, y } = FALLBACK_SLOTS[slot];

  return (
    <G
      accessibilityLabel={`成长印记：${trait}`}
      testID={`trait-mark-fallback-${slot}`}
      transform={`translate(${x} ${y})`}
    >
      <Circle cx="0" cy="0" r="7" fill={colors.surfaceSoft} stroke={colors.lavenderSoft} strokeWidth="2" />
      <Path d="M0 -4 L4 0 L0 4 L-4 0 Z" fill={colors.mint} />
    </G>
  );
}

export function PetAvatar({ pet, size = 148 }: PetAvatarProps) {
  const bodyColor = coreColor(pet.identityAnchors.coreColor);
  const isRound = pet.identityAnchors.silhouette.includes("圆");
  const hasAntennae = pet.identityAnchors.signatureOrgan.includes("触角");
  const listens = pet.abstractTraits.some((trait) => trait.includes("倾听"));
  const organizesPlay = pet.abstractTraits.some(
    (trait) => trait.includes("游戏") || trait.includes("组织"),
  );

  return (
    <Svg
      accessibilityLabel={`${pet.name}，${pet.identityAnchors.silhouette}${pet.identityAnchors.coreColor}异宠`}
      width={size}
      height={size}
      viewBox="0 0 160 160"
    >
      <Defs>
        <LinearGradient id={`pet-body-${pet.id}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={bodyColor} />
          <Stop offset="1" stopColor={colors.lavender} />
        </LinearGradient>
      </Defs>
      <Circle cx="80" cy="82" r="70" fill="rgba(230, 225, 255, 0.07)" />
      {organizesPlay ? (
        <G opacity={0.85}>
          <Circle cx="23" cy="66" r="4" fill={colors.mint} />
          <Circle cx="136" cy="90" r="5" fill={colors.coralSoft} />
          <Rect x="125" y="46" width="9" height="9" rx="3" fill={colors.lavenderSoft} />
        </G>
      ) : null}
      {hasAntennae ? (
        <G stroke={colors.coralSoft} strokeWidth="5" strokeLinecap="round">
          <Path d="M62 45 C58 25 47 21 43 15" />
          <Path d="M98 45 C102 25 113 21 117 15" />
          <Circle cx="42" cy="14" r="7" fill={colors.mint} stroke="none" />
          <Circle cx="118" cy="14" r="7" fill={colors.mint} stroke="none" />
        </G>
      ) : null}
      <Path
        d={
          isRound
            ? "M80 37 C113 37 135 59 135 91 C135 122 113 141 80 141 C47 141 25 122 25 91 C25 59 47 37 80 37 Z"
            : "M80 32 L132 76 L116 137 L44 137 L28 76 Z"
        }
        fill={`url(#pet-body-${pet.id})`}
      />
      {listens ? (
        <G fill="none" stroke={colors.mint} strokeWidth="4" strokeLinecap="round">
          <Path d="M35 74 C22 78 22 101 38 105" />
          <Path d="M125 74 C138 78 138 101 122 105" />
        </G>
      ) : null}
      <Ellipse cx="60" cy="84" rx="8" ry="11" fill={colors.textDark} />
      <Ellipse cx="100" cy="84" rx="8" ry="11" fill={colors.textDark} />
      <Circle cx="62" cy="81" r="2.5" fill="#FFD884" />
      <Circle cx="102" cy="81" r="2.5" fill="#FFD884" />
      <Path
        d="M67 109 C75 116 85 116 93 109"
        fill="none"
        stroke={colors.textDark}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <Ellipse cx="48" cy="104" rx="8" ry="4" fill={colors.coralSoft} opacity={0.72} />
      <Ellipse cx="112" cy="104" rx="8" ry="4" fill={colors.coralSoft} opacity={0.72} />
      {pet.abstractTraits.filter(isEvolutionVisualTrait).map((trait) => (
        <EvolutionTraitMark key={trait} trait={trait} />
      ))}
      {pet.abstractTraits
        .filter((trait) => !isEvolutionVisualTrait(trait) && !isInitialTraitMark(trait))
        .map((trait) => (
          <FallbackTraitMark key={trait} trait={trait} />
        ))}
    </Svg>
  );
}
