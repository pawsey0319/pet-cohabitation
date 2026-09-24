import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChatMessage, ChatSpace } from "../data/types";

export type ReadReceipt = { spaceId: string; readSequence: number; latestSequence: number; unreadCount: number };
type Pending = { messageId: string; sequence: number; at: string };
type Entry = { pending?: Pending; receipt?: ReadReceipt };
const accounts = new Map<string, Map<string, Entry>>();
const listeners = new Map<string, Set<() => void>>();
const active = new Map<string, Promise<void>>();
const writes = new Map<string, Promise<unknown>>();
const epochs = new Map<string, number>();
const keyFor = (owner: string) => `pet-read-state-v3:${owner}`;
function entries(owner: string) { let value = accounts.get(owner); if (!value) { value = new Map(); accounts.set(owner, value); } return value; }
function emit(owner: string) { listeners.get(owner)?.forEach(fn => fn()); }
function persist(owner: string) {
  const epoch = epochs.get(owner) ?? 0;
  const task = (writes.get(owner) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    if ((epochs.get(owner) ?? 0) !== epoch) return;
    await AsyncStorage.setItem(keyFor(owner), JSON.stringify([...entries(owner)]));
  });
  writes.set(owner,task); void task.catch(() => undefined);
}
export function subscribeReadState(owner: string, listener: () => void) {
  const set=listeners.get(owner) ?? new Set();set.add(listener);listeners.set(owner,set);
  return () => { set.delete(listener); };
}
export async function restoreReadState(owner: string) {
  const epoch=epochs.get(owner) ?? 0;
  try {
    const raw=await AsyncStorage.getItem(keyFor(owner));
    if (!raw || epoch !== (epochs.get(owner) ?? 0)) return;
    for (const [id,value] of JSON.parse(raw) as [string,Entry][]) {
      if (!entries(owner).has(id)) entries(owner).set(id,value);
    }
    emit(owner);
  } catch { /* A corrupt read cache never replaces server truth. */ }
}
export function markLocallyRead(owner: string, spaceId: string, message: ChatMessage) {
  const old=entries(owner).get(spaceId) ?? {};
  const sequence=message.spaceSequence ?? 0;
  if (sequence && sequence <= Math.max(old.pending?.sequence ?? 0,old.receipt?.readSequence ?? 0)) return;
  if (!sequence && old.pending?.messageId === message.id) return;
  entries(owner).set(spaceId,{...old,pending:{messageId:message.id,sequence,at:message.createdAt}});
  persist(owner);emit(owner);
}
export function applyReadState(owner: string, spaces: readonly ChatSpace[]): readonly ChatSpace[] {
  return spaces.map(space => {
    const value=entries(owner).get(space.id);if (!value) return space;
    const through=Math.max(value.pending?.sequence ?? 0,value.receipt?.readSequence ?? 0,space.lastReadSequence ?? 0);
    if (space.latestSequence !== undefined && through>=space.latestSequence) return {...space,unreadCount:0};
    // Once a list already contains this read cursor, its count is newer authority:
    // deletion/muting may change the count without advancing the last message.
    if (value.receipt && space.latestSequence === value.receipt.latestSequence && value.receipt.readSequence > (space.lastReadSequence ?? 0)) return {...space,unreadCount:Math.min(space.unreadCount,value.receipt.unreadCount)};
    // Compatibility only: never suppress a message newer than the visible one.
    if (space.latestSequence === undefined && value.pending && space.lastMessageAt && space.lastMessageAt <= value.pending.at) return {...space,unreadCount:0};
    return space;
  });
}
export function flushReadState(owner: string, send: (space: string,id: string) => Promise<ReadReceipt | void>): Promise<void> {
  const running=active.get(owner);if(running) return running;
  const epoch=epochs.get(owner) ?? 0;
  const work=(async()=>{
    const attempted=new Set<string>();
    for (;;) {
      if (epoch !== (epochs.get(owner) ?? 0)) return;
      const candidate=[...entries(owner)].find(([id,v])=>v.pending&&!attempted.has(`${id}:${v.pending.messageId}`));
      if (!candidate) return;
      const [space,value]=candidate;const pending=value.pending!;attempted.add(`${space}:${pending.messageId}`);
      try {
        const receipt=await send(space,pending.messageId);
        if (epoch !== (epochs.get(owner) ?? 0)) return;
        const current=entries(owner).get(space);if(!current)continue;
        if(receipt && receipt.readSequence >= (current.receipt?.readSequence ?? 0)) current.receipt=receipt;
        if(current.pending?.messageId===pending.messageId) delete current.pending;
        persist(owner);emit(owner);
      } catch { /* Offline receipts stay pending; retry on foreground/network restore. */ }
    }
  })().finally(()=>{if(active.get(owner)===work)active.delete(owner);});
  active.set(owner,work);return work;
}
export async function clearReadState(owner: string) {
  epochs.set(owner,(epochs.get(owner) ?? 0)+1);accounts.delete(owner);active.delete(owner);
  await writes.get(owner)?.catch(()=>undefined);writes.delete(owner);
  await AsyncStorage.removeItem(keyFor(owner));emit(owner);
}
export function revokeSpaceReadState(owner: string, space: string) { entries(owner).delete(space);persist(owner);emit(owner); }
