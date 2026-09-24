import { useEffect } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useSession } from "../auth/SessionProvider";
import { createChatRepository } from "../data/chatRepository";
import { getChatDelivery,stopChatDelivery } from "./deliveryRuntime";
import { flushReadState,restoreReadState } from "./readState";

export function ChatRuntimeBootstrap(){
  const {profile}=useSession();
  useEffect(()=>{
    if(!profile)return;
    const repository=createChatRepository(profile);
    const runtime=getChatDelivery(profile,repository);
    const syncRead=()=>void flushReadState(profile.id,(space,id)=>repository.markRead(space,id));
    void restoreReadState(profile.id).then(syncRead);
    const network=NetInfo.addEventListener(state=>{runtime.setOnline(state.isConnected!==false);if(state.isConnected)syncRead();});
    const lifecycle=AppState.addEventListener("change",state=>{if(state==='active'){void runtime.flush().catch(()=>undefined);syncRead();}});
    return()=>{network();lifecycle.remove();stopChatDelivery(profile.id);};
  },[profile?.id]);
  return null;
}
