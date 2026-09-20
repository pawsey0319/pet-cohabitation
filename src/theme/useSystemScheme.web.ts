import { useSyncExternalStore } from "react";
const query=typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");
const subscribe=(changed:()=>void)=>{
  query?.addEventListener("change",changed);
  return ()=>query?.removeEventListener("change",changed);
};
export function useSystemScheme():"light"|"dark" {
  return useSyncExternalStore(subscribe,()=>query?.matches?"dark":"light",()=>"light");
}
