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
    </Svg>
  );
}
