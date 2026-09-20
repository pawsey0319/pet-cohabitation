import type { PetPrivateMessage } from "../data/types";

const compare = (a: PetPrivateMessage, b: PetPrivateMessage) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
/** Refresh only the authoritative newest window, retaining already paged older rows. */
export function mergePrivateHistory(current: readonly PetPrivateMessage[], incoming: readonly PetPrivateMessage[], latest = false): PetPrivateMessage[] {
  const sorted = [...incoming].sort(compare);
  const serverRequests = new Set(sorted.filter(row => row.role === "owner").map(row => row.requestKey).filter(Boolean));
  const retained = current.filter(row => {
    if (row.id.startsWith("pending:")) return !serverRequests.has(row.requestKey);
    return !latest || (sorted.length > 0 && compare(row, sorted[0]) < 0);
  });
  return [...new Map([...retained, ...sorted].map(row => [row.id, row])).values()].sort(compare);
}
