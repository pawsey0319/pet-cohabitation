import { useEffect, useRef, useState, type ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useSession } from "../auth/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { createRequestId } from "../lib/uuid";
import { stabilizeMediaForOutbox, removeStabilizedMedia } from "../chat/mediaFile";
import { visionRequest, readVisionImage } from "./repository";
import { visionError, type VisionAttachment } from "./types";
export function VisionAttachmentPicker(props: { value: VisionAttachment | null; onChange(value: VisionAttachment | null): void; disabled?: boolean; compact?: boolean; trailing?:ReactNode }) {
 const { profile } = useSession(); return profile ? <Picker key={profile.id} {...props} ownerId={profile.id} /> : null;
}
function Picker({ value, onChange, disabled, ownerId, compact, trailing }: { value: VisionAttachment | null; onChange(value: VisionAttachment | null): void; disabled?: boolean; ownerId: string; compact?:boolean; trailing?:ReactNode }) {
 const { theme } = useAppTheme(); const active = useRef(true); const [available, setAvailable] = useState<boolean | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
 const [remotePreview,setRemotePreview]=useState<{assetId:string;url:string}|null>(null);
 useEffect(()=>{let current=true;setRemotePreview(null);if(value?.asset)void readVisionImage(ownerId,value.asset.id).then(image=>{if(current)setRemotePreview({assetId:image.asset.id,url:image.url});}).catch(()=>undefined);return()=>{current=false;};},[ownerId,value?.asset?.id]);
 useEffect(() => { active.current = true; void visionRequest<{ available: boolean }>(ownerId, { action: "capabilities" }).then(result => { if (active.current) setAvailable(result.available); }).catch(() => { if (active.current) setAvailable(false); }); return () => { active.current = false; }; }, [ownerId]);
 const choose = async (camera: boolean) => {
  if (disabled || busy || !available) return; setBusy(true); setError(null);
  try {
   if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error("camera_denied");
   const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: false, selectionLimit: 1, quality: 1 });
   const photo = result.assets?.[0]; if (result.canceled || !photo || !active.current) return;
   const resize = photo.width >= photo.height ? { width: Math.min(photo.width, 1536) } : { height: Math.min(photo.height, 1536) };
   const converted = await ImageManipulator.manipulateAsync(photo.uri, [{ resize }], { compress: .9, format: ImageManipulator.SaveFormat.JPEG });
   if(!active.current)return;
   const uploadId=createRequestId();const uri=await stabilizeMediaForOutbox(converted.uri,ownerId,`vision-${uploadId}`);
   if (active.current) onChange({ uri, uploadId });else await removeStabilizedMedia(uri);
  } catch (reason) { if (active.current) setError(reason instanceof Error && reason.message === "camera_denied" ? "相机权限未开启，也可以从相册选择。" : visionError(reason)); } finally { if (active.current) setBusy(false); }
 };
 const button = (title: string, onPress: () => void, blocked = false) => <Pressable accessibilityRole="button" disabled={blocked} onPress={onPress} style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: "center", opacity: blocked ? .45 : 1 }}><Text style={{ color: theme.primary }}>{title}</Text></Pressable>;
 const uri=remotePreview&&remotePreview.assetId===value?.asset?.id?remotePreview.url:value?.uri;
 return <View style={{ gap: 6 }}><View style={{ flexDirection: "row", alignItems: "center",flexWrap:"wrap" }}>{compact&&!available?button(available===false?"图片 · 暂不可用":"图片 · 检查中",()=>undefined,true):<>{button(busy ? "读取图片…" : "相册", () => void choose(false), disabled || busy || !available)}{button("拍照", () => void choose(true), disabled || busy || !available)}</>}{trailing}</View>{value?<View style={{flexDirection:"row",alignItems:"center",gap:8}}>{uri ? <Image accessibilityLabel="待发送图片" source={{ uri }} style={{ width:compact?60:100, height:compact?60:100, borderRadius: 8 }} resizeMode="contain" /> : value.asset?<Text style={{color:theme.muted}}>已保留上传的图片</Text>:null}<View style={{flex:1}}><Text style={{ color: theme.muted, fontSize: 12 }}>和文字一起发送，不会默认形成记忆。</Text>{button("移除图片", () => onChange(null), disabled || busy)}</View></View>:null}{!compact&&available === false ? <Text style={{ color: theme.muted, fontSize: 12 }}>图片理解暂不可用，可以继续用文字交流。</Text> : null}{error ? <Text style={{ color: theme.danger, fontSize: 12 }}>{error}</Text> : null}</View>;
}
