import {Pressable,Text} from "react-native";
import {router,useLocalSearchParams} from "expo-router";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {KeyboardScreen} from "../src/components/KeyboardLayout";
import {UnifiedSearch} from "../src/search/UnifiedSearch";
import {useAppTheme} from "../src/theme/ThemeProvider";
export default function SearchPage(){const {theme}=useAppTheme(),insets=useSafeAreaInsets(),params=useLocalSearchParams<{q?:string;spaceId?:string}>();return <KeyboardScreen style={{flex:1,paddingTop:insets.top,backgroundColor:theme.page}}><Pressable accessibilityLabel="返回" onPress={()=>router.back()}><Text style={{padding:16,color:theme.primary}}>‹ 返回</Text></Pressable><UnifiedSearch initialQuery={params.q} spaceId={params.spaceId}/></KeyboardScreen>;}
