import { Pressable, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
export type PetSection = "companion" | "memory" | "growth" | "desktop";
export function PetSectionNav({value,onChange}:{value:PetSection;onChange:(section:PetSection)=>void}) {
  const {theme}=useAppTheme();
  return <View accessibilityRole="tablist" style={{flexDirection:"row",backgroundColor:theme.card,borderBottomWidth:1,borderColor:theme.line,paddingHorizontal:16}}>{([["companion","陪伴"],["memory","记忆"],["growth","成长"],["desktop","桌宠"]] as const).map(([key,label])=><Pressable key={key} accessibilityRole="tab" accessibilityState={{selected:key===value}} aria-selected={key===value} onPress={()=>onChange(key)} style={{flex:1,minHeight:48,alignItems:"center",justifyContent:"center",borderBottomWidth:2,borderBottomColor:key===value?theme.accent:"transparent"}}><Text style={{fontSize:15,fontWeight:key===value?"600":"400",color:key===value?theme.accent:theme.muted}}>{label}</Text></Pressable>)}</View>;
}
