import { AsyncStorageOutboxStore, type OutboxStore } from "./outbox";

export function createPersistentOutboxStore(ownerId: string): OutboxStore {
  return new AsyncStorageOutboxStore(ownerId);
}
