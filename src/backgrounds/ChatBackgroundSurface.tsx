import { useEffect, useState, type PropsWithChildren } from "react";
import { AppState, Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSession } from "../auth/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { useChatBackground } from "./ChatBackgroundProvider";
import { backgroundColors, type ChatBackgroundSelection } from "./types";

const fillStyle=StyleSheet.create({fill:{position:"absolute",left:0,right:0,top:0,bottom:0}}).fill;

export function useChatBackgroundColors(threadKey?:string) {
  const {theme}=useAppTheme();const {getBackground}=useChatBackground();
  return backgroundColors(getBackground(threadKey),theme.isDark);
}

export function BackgroundArtwork({selection,style,children}:PropsWithChildren<{selection:ChatBackgroundSelection;style?:StyleProp<ViewStyle>}>) {
  const {theme}=useAppTheme();const {profile}=useSession();const {getAssetUrl}=useChatBackground();
  const owner=profile?.id;const assetId=selection.assetId;
  const [image,setImage]=useState<{owner:string;assetId:string;uri:string}|null>(null);
  const colors=backgroundColors(selection,theme.isDark);
  useEffect(()=>{
    let active=true;setImage(null);
    const load=async()=>{if(!assetId||!owner)return;const uri=await getAssetUrl(assetId);if(active&&uri)setImage({owner,assetId,uri});};
    void load().catch(()=>undefined);
    const timer=setInterval(()=>{void load().catch(()=>undefined);},45*60_000);
    const listener=AppState.addEventListener("change",state=>{if(state==="active")void load().catch(()=>undefined);});
    return()=>{active=false;clearInterval(timer);listener.remove();};
  },[assetId,owner,getAssetUrl]);
  const uri=image?.owner===owner&&image?.assetId===assetId?image.uri:null;
  return <View style={[{backgroundColor:colors.background,overflow:"hidden"},style]}>
    {uri?<><Image source={{uri}} resizeMode="cover" style={fillStyle} onError={()=>setImage(null)} accessible={false}/><View pointerEvents="none" style={[fillStyle,{backgroundColor:colors.overlay}]}/></>:null}
    {children}
  </View>;
}

export function ChatBackgroundSurface({threadKey,children,style}:PropsWithChildren<{threadKey?:string;style?:StyleProp<ViewStyle>}>) {
  const {getBackground}=useChatBackground();
  return <BackgroundArtwork selection={getBackground(threadKey)} style={style}>{children}</BackgroundArtwork>;
}
