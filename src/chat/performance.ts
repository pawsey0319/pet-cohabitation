// Session-only diagnostics: never collect message text, account/group/request IDs,
// media URLs or model inputs. Nothing is uploaded automatically.
type Phase = "local_save" | "send_receipt";
type Sample = { phase: Phase; ms: number; failed: boolean };
const samples: Sample[] = [];
export function recordChatTiming(phase: Phase, startedAt: number, failed = false) {
  const ms = Math.max(0, Date.now() - startedAt);
  samples.push({ phase, ms, failed });
  if (samples.length > 300) samples.shift();
}
export function chatTimingSummary() {
  return (["local_save", "send_receipt"] as const).map(phase => {
    const rows = samples.filter(sample => sample.phase === phase);
    const values = rows.filter(sample => !sample.failed).map(sample => sample.ms).sort((a, b) => a - b);
    const percentile = (p: number) => values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
    return { phase, attempts: rows.length, failures: rows.filter(sample => sample.failed).length, p50Ms: percentile(.5), p95Ms: percentile(.95) };
  });
}
export function clearChatTimings() { samples.length = 0; }
