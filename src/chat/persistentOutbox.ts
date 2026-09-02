import { AsyncStorageOutboxStore, type OutboxStore } from "./outbox";

export function createPersistentOutboxStore(): OutboxStore {
  return new AsyncStorageOutboxStore();
}
