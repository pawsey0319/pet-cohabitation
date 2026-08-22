import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Stop } from "react-native-svg";
import { colors } from "../theme/tokens";

function hash(value: string): number { return [...value].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 2166136261); }

export function GenerativePetPreview({ seed, size = 280 }: Readonly<{ seed: string; size?: number }>) {
  const code = hash(seed); const hue = code % 3; const body = [colors.lavender, colors.mint, colors.coralSoft][hue]; const accent = [colors.mint, colors.coral, colors.lavenderSoft][(hue + 1) % 3];
  const eyeOffset = 5 + (code % 7); const antenna = code % 2 === 0; const tail = code % 5 > 1;
  return (
    <Svg accessibilityLabel="异宠当前候选外观" width={size} height={size} viewBox="0 0 240 240">
      <Defs><LinearGradient id={`pet-${code}`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={body} /><Stop offset="1" stopColor={accent} /></LinearGradient></Defs>
      <Ellipse cx="120" cy="211" rx="63" ry="12" fill="rgba(5,4,18,.3)" />
      {tail ? <Path d="M177 142 C225 124 221 181 187 175 C211 163 204 146 178 156" fill="none" stroke={accent} strokeWidth="13" strokeLinecap="round" /> : null}
      <Path d="M65 93 C54 44 86 26 119 50 C151 24 192 47 178 95 C207 124 194 183 160 199 C136 213 91 207 71 188 C46 164 44 120 65 93 Z" fill={`url(#pet-${code})`} />
      {antenna ? <G fill="none" stroke={accent} strokeWidth="7" strokeLinecap="round"><Path d="M93 56 C71 25 91 15 100 40" /><Circle cx="84" cy="20" r="9" fill={accent} stroke="none" /></G> : <Path d="M91 52 C72 21 57 41 75 69 Z" fill={accent} />}
      <G fill={colors.textDark}><Ellipse cx={96 - eyeOffset / 2} cy="113" rx="8" ry="13" /><Ellipse cx={144 + eyeOffset / 2} cy="113" rx="8" ry="13" /></G>
      <G fill={colors.white} opacity={0.82}><Circle cx={94 - eyeOffset / 2} cy="109" r="3" /><Circle cx={142 + eyeOffset / 2} cy="109" r="3" /></G>
      <Path d="M107 142 Q120 151 134 141" fill="none" stroke={colors.textDark} strokeWidth="5" strokeLinecap="round" />
      <Path d="M76 159 C91 148 93 184 79 189" fill="none" stroke={accent} strokeWidth="10" strokeLinecap="round" opacity={0.75} />
      <Circle cx="159" cy="166" r={8 + code % 6} fill={accent} opacity={0.75} />
    </Svg>
  );
}
