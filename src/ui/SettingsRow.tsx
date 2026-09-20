import { Pressable, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { Icon, type IconName } from "./Icon";
export function SettingsRow({title,note,icon,onPress}:{title:string;note?:string;icon:IconName;onPress:()=>void}) {
  const {theme}=useAppTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({pressed})=>({flexDirection:"row",alignItems:"center",gap:14,backgroundColor:theme.card,paddingHorizontal:16,minHeight:64,opacity:pressed?.7:1,borderBottomWidth:1,borderColor:theme.line})}><Icon name={icon} color={theme.accent}/><View style={{flex:1,gap:4}}><Text style={{fontSize:16,color:theme.text}}>{title}</Text>{note?<Text style={{fontSize:12,color:theme.muted}}>{note}</Text>:null}</View><Icon name="chevron" size={17} color={theme.muted}/></Pressable>;
}
