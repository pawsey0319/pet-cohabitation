import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useSession } from "../auth/SessionProvider";
import { createPetRepository } from "../data/petRepository";
import { cachedPetRepository, PetWorkspaceCache } from "./workspaceCache";

function useSessionWorkspace() {
  const { profile } = useSession();
  return useMemo(() => {
    if (!profile) return null;
    const cache = new PetWorkspaceCache(), raw = createPetRepository(profile);
    return { ownerId: profile.id, cache, raw, repository: cachedPetRepository(raw, cache) };
  }, [profile?.id]);
}
const Context = createContext<ReturnType<typeof useSessionWorkspace>>(null);
export function PetWorkspaceProvider({ children }: { children: ReactNode }) {
  const workspace = useSessionWorkspace();
  const lifecycle = useRef({ workspace, generation: 0 });
  useEffect(() => {
    const generation = lifecycle.current.generation + 1;
    lifecycle.current = { workspace, generation };
    if (!workspace) return;
    const unsubscribe = workspace.raw.subscribe(() => workspace.cache.invalidate());
    return () => {
      unsubscribe(); workspace.cache.invalidate(undefined, true);
      queueMicrotask(() => { if (lifecycle.current.workspace !== workspace || lifecycle.current.generation === generation) workspace.cache.dispose(); });
    };
  }, [workspace]);
  return <Context.Provider value={workspace}>{children}</Context.Provider>;
}
export function usePetWorkspace() { return useContext(Context); }
