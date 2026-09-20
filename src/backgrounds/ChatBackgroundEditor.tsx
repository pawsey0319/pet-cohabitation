import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useSession } from "../auth/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { useChatBackground } from "./ChatBackgroundProvider";
import { BackgroundArtwork } from "./ChatBackgroundSurface";
import { BackgroundLibrary } from "./BackgroundLibrary";
import { DEFAULT_BACKGROUND, type ChatBackgroundAsset } from "./types";
import { KeyboardScreen, KeyboardScrollView, KeyboardTextInput } from "../components/KeyboardLayout";
import { BACKGROUND_PRESETS, backgroundColors, backgroundErrorMessage, normalizeThreadKey, type BackgroundPalette, type ChatBackgroundSelection } from "./types";

const fillStyle=StyleSheet.create({fill:{position:"absolute",left:0,right:0,top:0,bottom:0}}).fill;

export function ChatBackgroundEditor({visible,onClose,threadKey}: {visible:boolean;onClose:()=>void;threadKey?:string}) {
  const {profile}=useSession();
  if(!visible)return null;
  return <VisibleChatBackgroundEditor key={`${profile?.id??"guest"}:${threadKey??"global"}`} visible={visible} onClose={onClose} threadKey={threadKey}/>;
}

function VisibleChatBackgroundEditor({visible,onClose,threadKey}: {visible:boolean;onClose:()=>void;threadKey?:string}) {
  const {theme}=useAppTheme();const {profile,isLocalDemo}=useSession();const background=useChatBackground();
  let currentKey:ReturnType<typeof normalizeThreadKey>="global";let invalidThread=false;
  try{currentKey=normalizeThreadKey(threadKey,isLocalDemo);}catch{invalidThread=true;}
  const hasThread=currentKey!=="global";
  const [scope,setScope]=useState<"global"|"thread">(hasThread?"thread":"global");
  const [tab,setTab]=useState<"preset"|"upload"|"ai">("preset");
  const [selection,setSelection]=useState<ChatBackgroundSelection>(()=>background.getBackground(currentKey));
  const [prompt,setPrompt]=useState("");const [notice,setNotice]=useState<string|null>(null);
  const [libraryOpen,setLibraryOpen]=useState(false);const [parentAsset,setParentAsset]=useState<ChatBackgroundAsset|undefined>(undefined);
  const [working,setWorking]=useState(false);const [localPhoto,setLocalPhoto]=useState<{uri:string;width:number;height:number}|null>(null);
  const [position,setPosition]=useState<"top"|"center"|"bottom">("center");
  const [cropped,setCropped]=useState<string|null>(null);const cropVersion=useRef(0);
  const initialized=useRef<string|null>(null);const ownerRef=useRef(profile?.id);ownerRef.current=profile?.id;
  const targetKey=scope==="global"?"global":currentKey;
  const job=background.generation;const generating=job?.status==="queued"||job?.status==="running"||job?.status==="uploading";
  const colors=backgroundColors(selection,theme.isDark);
  useEffect(()=>()=>{ownerRef.current=undefined;},[]);

  useEffect(()=>{
    if(!visible){initialized.current=null;return;}
    const key=`${profile?.id}:${currentKey}`;if(initialized.current===key)return;
    initialized.current=key;setSelection(background.getBackground(currentKey));setScope(hasThread?"thread":"global");setNotice(null);setWorking(false);setLocalPhoto(null);setCropped(null);setTab("preset");setPrompt(background.generation?.prompt??"");
  },[visible,profile?.id,currentKey,hasThread,background]);

  useEffect(()=>{
    const version=++cropVersion.current;if(!localPhoto){setCropped(null);return;}
    const width=Math.min(localPhoto.width,localPhoto.height*9/16);const height=width*16/9;
    const originX=(localPhoto.width-width)/2;const originY=position==="top"?0:position==="bottom"?localPhoto.height-height:(localPhoto.height-height)/2;
    void ImageManipulator.manipulateAsync(localPhoto.uri,[{crop:{originX:Math.floor(originX),originY:Math.floor(originY),width:Math.floor(width),height:Math.floor(height)}},{resize:{width:900}}],{compress:0.88,format:ImageManipulator.SaveFormat.JPEG}).then(result=>{if(cropVersion.current===version)setCropped(result.uri);}).catch(()=>{if(cropVersion.current===version)setNotice("这张图片暂时无法裁切，请换一张试试。");});
    return()=>{cropVersion.current+=1;};
  },[localPhoto,position]);

  const run=async(action:()=>Promise<void>)=>{const owner=ownerRef.current;setWorking(true);setNotice(null);try{await action();}catch(reason){if(ownerRef.current===owner)setNotice(reason instanceof Error?reason.message:"暂时未完成，请重试。");}finally{if(ownerRef.current===owner)setWorking(false);}};
  const choosePhoto=()=>run(async()=>{
    const owner=ownerRef.current;
    const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsEditing:false,quality:1,selectionLimit:1});
    if(!result.canceled&&result.assets[0]&&ownerRef.current===owner){const asset=result.assets[0];setCropped(null);setPosition("center");setLocalPhoto({uri:asset.uri,width:asset.width,height:asset.height});}
  });
  const apply=()=>run(async()=>{
    if(invalidThread)throw new Error("这个聊天尚未准备好，请关闭后重新打开背景设置。");
    let next=selection;const owner=ownerRef.current;
    if(tab==="upload"&&cropped){const asset=await background.upload(cropped);if(ownerRef.current!==owner)return;next={presetId:null,assetId:asset.id,palette:selection.palette};setSelection(next);setLocalPhoto(null);setCropped(null);}
    await background.apply(next,targetKey);if(ownerRef.current===owner)onClose();
  });
  const button=(label:string,action:()=>void,primary=false,disabled=false)=> <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={action} style={[styles.button,{backgroundColor:primary?theme.primary:theme.cardSoft,opacity:disabled?0.45:1}]}><Text style={{color:primary?theme.onPrimary:theme.text,fontSize:15,fontWeight:"600"}}>{label}</Text></Pressable>;

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
    <SafeAreaView style={[styles.safe,{backgroundColor:theme.page}]} edges={["top","bottom"]}>
      <View style={[styles.header,{borderColor:theme.line}]}>{button("关闭",onClose)}<Text style={[styles.title,{color:theme.text}]}>聊天背景</Text><View style={{width:64}}/></View>
      <KeyboardScreen style={styles.safe}>
        <KeyboardScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.note,{color:theme.muted}]}>让聊天更像你的空间。背景只有你自己可见。</Text>
          <View style={styles.row}>{button("全部聊天",()=>{setScope("global");setSelection(background.getBackground("global"));},scope==="global",working)}{hasThread?button("仅此聊天",()=>{setScope("thread");setSelection(background.getBackground(currentKey));},scope==="thread",working):null}</View>
          <Text style={[styles.note,{color:theme.muted}]}>{scope==="global"?"作为全部聊天的默认背景，已单独设置的聊天保持不变。":"这次设置仅用于当前聊天。"}</Text>
          <View style={[styles.preview,{borderColor:theme.line}]}>
            <BackgroundArtwork selection={selection} style={styles.previewArtwork}>
              {tab==="upload"&&cropped?<><Image source={{uri:cropped}} style={fillStyle} resizeMode="cover"/><View style={[fillStyle,{backgroundColor:colors.overlay}]}/></>:null}
              <Text style={[styles.previewDate,{color:theme.muted,backgroundColor:theme.card}]}>背景预览</Text>
              <View style={[styles.bubble,{backgroundColor:colors.bubble}]}><Text style={{color:colors.text,fontSize:16,lineHeight:24}}>慢慢说，我在听。</Text></View>
              <View style={[styles.bubble,styles.ownBubble,{backgroundColor:colors.userBubble}]}><Text style={{color:colors.userText,fontSize:16,lineHeight:24}}>今天想换一点新的心情。</Text></View>
            </BackgroundArtwork>
          </View>
          <View style={styles.row}>{([['preset','推荐'],['upload','我的图片'],['ai','AI 设计']] as const).map(([id,label])=><Pressable key={id} accessibilityRole="tab" accessibilityState={{selected:tab===id}} onPress={()=>{setTab(id);setNotice(null);}} style={[styles.tab,{borderColor:tab===id?theme.primary:theme.line,backgroundColor:tab===id?theme.cardSoft:theme.card}]}><Text style={{color:tab===id?theme.primary:theme.text,fontWeight:"600"}}>{label}</Text></Pressable>)}</View>
          {tab==="preset"?<View style={styles.grid}>{BACKGROUND_PRESETS.map(preset=><Pressable key={preset.id} accessibilityRole="button" accessibilityLabel={`${preset.name}背景`} onPress={()=>setSelection({presetId:preset.id,assetId:null,palette:preset.palette})} style={[styles.swatch,{backgroundColor:theme.isDark?preset.dark:preset.light,borderColor:selection.presetId===preset.id?theme.primary:theme.line}]}><Text style={{color:theme.text,fontWeight:"600"}}>{preset.name}{selection.presetId===preset.id?" ✓":""}</Text></Pressable>)}</View>:null}
          {tab==="upload"?<View style={styles.stack}>{button(localPhoto?"换一张图片":"从相册选择",()=>{void choosePhoto();},false,working)}<Text style={[styles.note,{color:theme.muted}]}>先调整画面，再应用为背景。图片会保存在你的个人空间。</Text>{localPhoto?<View style={styles.row}>{([['top','保留上方'],['center','居中'],['bottom','保留下方']] as const).map(([id,label])=><Pressable key={id} onPress={()=>{setPosition(id);setCropped(null);}} style={[styles.tab,{backgroundColor:position===id?theme.cardSoft:theme.card,borderColor:position===id?theme.primary:theme.line}]}><Text style={{color:theme.text}}>{label}</Text></Pressable>)}</View>:null}</View>:null}
          {tab==="ai"?<View style={styles.stack}>
            <Text style={[styles.section,{color:theme.text}]}>描述你想要的画面</Text>
            {parentAsset?<View style={styles.stack}><Text style={[styles.note,{color:theme.muted}]}>基于「{parentAsset.name??"已选背景"}」继续设计，原图会保留。</Text>{button("改为生成全新背景",()=>setParentAsset(undefined),false,working||generating)}</View>:null}
            <KeyboardTextInput accessibilityLabel="背景设计描述" value={prompt} onChangeText={setPrompt} multiline maxLength={600} placeholder="例如：雨后的竹林，浅灰绿色，安静留白，画面中间简洁一些" placeholderTextColor={theme.muted} style={[styles.input,{color:theme.text,backgroundColor:theme.card,borderColor:theme.line}]}/>
            <Text style={[styles.note,{color:theme.muted}]}>{prompt.length}/600 · 生成后先预览，由你决定是否应用。</Text>
            {button(generating?"正在生成…":parentAsset?"生成编辑版本":job?.status==="failed"?"重新生成":"生成新背景",()=>{void run(()=>background.generate(prompt,parentAsset));},true,working||generating||prompt.trim().length<4||!background.canGenerate||(!!parentAsset&&!background.canEdit))}
            {!background.canGenerate?<Text style={[styles.note,{color:theme.muted}]}>{isLocalDemo?"登录后即可使用 AI 设计。":"正在读取背景设置…"}</Text>:null}
            {generating?<View accessibilityLiveRegion="polite" style={[styles.status,{backgroundColor:theme.cardSoft}]}><ActivityIndicator color={theme.primary}/><Text style={[styles.note,{color:theme.text,flex:1}]}>正在绘制你的背景，通常需要一些时间。可以先关闭页面，回来继续查看。</Text></View>:null}
            {job?.status==="failed"?<Text accessibilityLiveRegion="polite" style={{color:theme.danger}}>{backgroundErrorMessage(job.error_code??"")}</Text>:null}
            {job?.status==="succeeded"?<Text style={[styles.note,{color:theme.muted}]}>新背景已放入下方「我的背景」，点击预览后再应用。</Text>:null}
            {background.error&&generating?button("重试连接",()=>{void run(background.retryConnection);},false,working):null}
          </View>:null}
          <Text style={[styles.section,{color:theme.text}]}>搭配气泡颜色</Text>
          <View style={styles.row}>{([['warm','暖杏'],['sage','灰绿'],['slate','雾蓝']] as [BackgroundPalette,string][]).map(([id,label])=><Pressable key={id} accessibilityRole="button" onPress={()=>setSelection(current=>({...current,palette:id}))} style={[styles.tab,{backgroundColor:backgroundColors({...selection,palette:id},theme.isDark).userBubble,borderColor:selection.palette===id?theme.primary:theme.line}]}><Text style={{color:backgroundColors({...selection,palette:id},theme.isDark).userText}}>{label}{selection.palette===id?" ✓":""}</Text></Pressable>)}</View>
          {background.assets.length?<><Text style={[styles.section,{color:theme.text}]}>我的背景</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>{background.assets.map(asset=><Pressable key={asset.id} accessibilityRole="button" accessibilityLabel={`${asset.source==="ai"?"AI 设计":"相册图片"}背景${selection.assetId===asset.id?"，已选中":""}`} onPress={()=>{setSelection({presetId:null,assetId:asset.id,palette:selection.palette});setLocalPhoto(null);setCropped(null);if(asset.prompt)setPrompt(asset.prompt);}} style={[styles.asset,{borderColor:selection.assetId===asset.id?theme.primary:theme.line}]}><BackgroundArtwork selection={{presetId:null,assetId:asset.id,palette:selection.palette}} style={styles.assetImage}/><Text numberOfLines={2} style={{color:theme.text,fontSize:12,padding:8}}>{asset.source==="ai"?asset.prompt:"我的图片"}</Text></Pressable>)}</ScrollView></>:null}
          {notice||background.error?<Text accessibilityLiveRegion="polite" style={{color:theme.danger,lineHeight:22}}>{notice??background.error}</Text>:null}
          {!background.ready?<Text style={[styles.note,{color:theme.muted}]}>正在读取背景设置…</Text>:null}
          {!isLocalDemo?button("管理全部背景",()=>setLibraryOpen(true),false,working):null}
          {button(working||background.saving?"正在保存…":scope==="global"?"应用到全部聊天":"应用到此聊天",()=>{void apply();},true,working||background.saving||!background.ready||(tab==="upload"&&!!localPhoto&&!cropped))}
          {hasThread&&scope==="thread"&&background.hasOverride(currentKey)?button("恢复使用全局背景",()=>{void run(async()=>{await background.resetToGlobal(currentKey);onClose();});},false,working||background.saving):null}
        </KeyboardScrollView>
      </KeyboardScreen>
      <BackgroundLibrary visible={libraryOpen} onClose={()=>setLibraryOpen(false)} onSelect={asset=>{setSelection({presetId:null,assetId:asset.id,palette:selection.palette});setLocalPhoto(null);setCropped(null);}} onEdit={asset=>{setParentAsset(asset);setTab("ai");setPrompt("");setSelection({presetId:null,assetId:asset.id,palette:selection.palette});setLocalPhoto(null);setCropped(null);}} onDeleted={id=>{if(selection.assetId===id)setSelection(DEFAULT_BACKGROUND);if(parentAsset?.id===id)setParentAsset(undefined);}}/>
    </SafeAreaView>
  </Modal>;
}

const styles=StyleSheet.create({safe:{flex:1},header:{paddingHorizontal:16,paddingVertical:8,borderBottomWidth:StyleSheet.hairlineWidth,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},title:{fontSize:18,fontWeight:"600"},content:{padding:20,gap:16,paddingBottom:32},row:{flexDirection:"row",gap:10,flexWrap:"wrap"},button:{minHeight:48,paddingHorizontal:16,paddingVertical:13,borderRadius:12,alignItems:"center",justifyContent:"center"},note:{fontSize:13,lineHeight:21},preview:{borderWidth:1,borderRadius:18,overflow:"hidden"},previewArtwork:{minHeight:225,padding:18,gap:16},previewDate:{fontSize:11,alignSelf:"center",paddingHorizontal:10,paddingVertical:4,borderRadius:6,overflow:"hidden"},bubble:{alignSelf:"flex-start",borderRadius:12,paddingHorizontal:14,paddingVertical:10,maxWidth:"88%"},ownBubble:{alignSelf:"flex-end"},tab:{minHeight:48,paddingVertical:12,paddingHorizontal:15,borderWidth:1,borderRadius:10,alignItems:"center",justifyContent:"center",flexGrow:1},grid:{flexDirection:"row",flexWrap:"wrap",gap:12},swatch:{width:"46%",minHeight:82,borderRadius:12,borderWidth:2,padding:16,justifyContent:"flex-end"},stack:{gap:12},section:{fontSize:15,fontWeight:"600"},input:{minHeight:115,borderWidth:1,borderRadius:12,padding:14,fontSize:16,lineHeight:25,textAlignVertical:"top"},status:{padding:14,borderRadius:12,flexDirection:"row",alignItems:"center",gap:12},shelf:{gap:12},asset:{width:118,borderWidth:2,borderRadius:12,overflow:"hidden"},assetImage:{height:140}});
