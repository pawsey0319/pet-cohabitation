import { useCallback, useEffect, useRef, useState } from "react";
import { createRequestId } from "../lib/uuid";
import { personalityError, personalityRequest, type PersonalitySnapshot } from "./client";
export function usePersonality(owner: string, spaceId?: string) {
  const [data, setData] = useState<PersonalitySnapshot | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const alive = useRef(true), sequence = useRef(0); const request = useRef<{ signature: string; id: string } | null>(null);
  const load = useCallback(async (page = 0) => {
    const revision = ++sequence.current;
    try {
      const next = await personalityRequest<PersonalitySnapshot>(owner, { action: "state", page, ...(spaceId ? { space_id: spaceId } : {}) });
      if (!alive.current || revision !== sequence.current) return;
      setData(previous => page && previous ? { ...next, evidence: [...previous.evidence, ...next.evidence], history: [...previous.history, ...next.history], relationships: [...previous.relationships, ...next.relationships] } : next); setError("");
    } catch (reason) { if (alive.current && revision === sequence.current) setError(personalityError(reason)); }
  }, [owner, spaceId]);
  useEffect(() => { alive.current = true; setData(null); void load(); return () => { alive.current = false; sequence.current++; }; }, [load]);
  const mutate = async (action: string, fields: Record<string, unknown> = {}): Promise<boolean> => {
    if (busy || !data) return false;
    const body = { action, expected_revision: data.state.revision, ...fields }, signature = JSON.stringify(body);
    if (request.current?.signature !== signature) request.current = { signature, id: createRequestId() };
    setBusy(true); setError("");
    try { await personalityRequest(owner, { ...body, request_id: request.current.id }); if (!alive.current) return false; await load(); request.current = null; return true; }
    catch (reason) { if (alive.current) setError(personalityError(reason)); return false; }
    finally { if (alive.current) setBusy(false); }
  };
  return { data, busy, error, load, mutate };
}
