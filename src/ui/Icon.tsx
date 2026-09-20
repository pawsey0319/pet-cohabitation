import Svg, { Path, Circle } from "react-native-svg";

const paths = {
  messages: "M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a9 9 0 0 1 18 0Z M7 10h8 M7 14h5",
  pet: "M5 11 3 4l6 3a11 11 0 0 1 6 0l6-3-2 7v5c0 4-14 4-14 0Z M9 12v1 M15 12v1 M10 16q2 2 4 0",
  user: "M4 21v-2a8 8 0 0 1 16 0v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  memory: "M5 3h14v18H5Z M9 7h6 M9 11h6 M9 15h3",
  back: "m14 5-7 7 7 7",
  chevron: "m9 5 7 7-7 7",
  plus: "M12 4v16 M4 12h16",
  search: "m16 16 5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  image: "M3 3h18v18H3Z m0 13 5-5 4 4 3-3 6 6 M8 7h.01",
  sun: "M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  shield: "m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5Z m-4 9 3 3 5-5",
  settings: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
  arrow: "M4 12h16 m-7-7 7 7-7 7",
  send: "m3 3 18 9-18 9 4-9Z M7 12h14",
  link: "m10 14 4-4 M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  check: "m5 12 4 4L19 6",
} as const;
export type IconName = keyof typeof paths | "more";
export function Icon({ name, size = 22, color = "#111111" }: { name:IconName; size?:number; color?:string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{name === "more" ? [5,12,19].map(cx => <Circle key={cx} cx={cx} cy={12} r={1.2} fill={color} />) : <Path d={paths[name]} />}</Svg>;
}
