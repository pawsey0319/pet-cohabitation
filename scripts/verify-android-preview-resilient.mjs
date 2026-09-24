// Read-only verifier transport wrapper. Never retries a received HTTP error or hash failure.
// The original Android manifest/asset verifier remains authoritative.
const originalFetch = globalThis.fetch;
const transportRetries = [];
globalThis.fetch = async (input, init) => {
  for (let attempt = 1; ; attempt++) {
    try { return await originalFetch(input, init); }
    catch (error) {
      if (attempt >= 4 || init?.signal?.aborted) throw error;
      transportRetries.push({ host: new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname,
        attempt, code: error?.cause?.code ?? error?.name ?? 'transport_error' });
      await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    }
  }
};
try { await import('./verify-android-preview.mjs'); }
finally { console.log(JSON.stringify({ verifierTransportRetries: transportRetries })); }
