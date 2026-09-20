# T04 bounded live-provider and transparent-image acceptance · 2026-09-14

**AI avatar worker/data path and persistent preview-confirmation protection passed. Transparent pet quality failed. T04 remains unaccepted.**

## Live avatar result

`& ./scripts/with-companion-env.ps1 -Script src/avatars/__tests__/live-ai.mjs` passed **35 checks** against isolated Supabase `127.0.0.1:47321`.

The process read only `IMAGE_API_BASE_URL`, `IMAGE_API_KEY`, and `IMAGE_MODEL` from the existing private product configuration. No credentials were logged. The configured product image model was `grok-imagine-image`; this was feature acceptance, not an external Grok text review. Exactly **one** real `images/generations` request was sent; the test transport blocks further provider requests, including the adapter's automatic retries. It returned a 1024 × 1024 JPEG, 186,743 bytes, in 7.001 seconds.

The synthetic subject is a turquoise furry imaginary pet with two ears, two arms, two feet and a lavender ribbon. The generated original visually includes all requested parts and clear framing. Its SHA256 is `5478975996dff25546044d0d645d2f5683191b483d0bbe44c8615ff46031ce96`.

Verified behavior:

- Real Auth accounts, uploaded old avatar, registered/applied state, service-only job claim, real lease and recovery, actual production `runAvatarGeneration` and `ImageModelAdapter`, real private Storage upload, guarded completion and exact SHA256.
- The same job was leased once without generation, then its lease was deliberately expired. The real worker acquired a new lease and generated the sole image. Active leases could not be stolen; old leases could not upload or late-commit. This is controlled lease recovery, not evidence of autonomous cloud scheduling.
- Real Edge status/read/apply: generation leaves the old applied image intact; owner can preview exact bytes; same-group members cannot discover/read/sign the private draft; explicit application grants same-group reads while unrelated accounts remain denied. Apply retry is idempotent. Peers cannot apply someone else's asset.
- A second job received an **injected transport timeout**, with zero additional provider requests. The real worker stored `image_model_timeout`, kept the existing applied AI avatar, and did not regenerate a terminal failure. This is an injected failure contract, not a live provider outage result.
- Generation retries reuse the claim; the live request and injected failed request each use one claim. Ten additional temporary quota reservations plus those two reach the shared avatar/background limit of 12; reservation 13 is rejected without image generation.
- Explicit restoration selects the original uploaded avatar, immediately denies new AI-avatar signed URLs to peers, and leaving the shared group revokes avatar state access. Previously issued URLs retain their existing bounded lifetime; immediate invalidation of such URLs was not claimed.
- Cleanup removed all three temporary accounts, their temporary space and two avatar objects. The live-image run itself made no global sweep, fixture restart, deployment, shared environment change, business model setting change or shared-code edit. Subsequent preview-confirmation changes are documented below.

Evidence: `test-results/avatar-live-20260914/report.json` and `avatar.jpg`. New reusable test entrypoints are `src/avatars/__tests__/live-ai.mjs` and `live-ai.deno.mjs`.

**Boundary:** primary Edge remains in its original `MODEL_MOCK_MODE=true` mode; real Edge `generate` correctly rejects with `avatar_mock_disabled` and consumes no quota. Actual generation was dispatched directly to the unchanged shared worker with process-only live settings. The image was created through real provider + local Supabase RPC/Storage; the production Edge background-dispatch runtime was not exercised with live settings. Signed preview URLs from local `kong` were translated to the equivalent desktop-reachable `127.0.0.1:47321` origin. This is not Android UI, production cloud or release acceptance.

## Locked rembg quality failure

The same authorized synthetic image was passed once through the actual local `transparent-worker/worker.py::process` using the existing verified model and Python environment. No other image was generated. No cloud lease or global job queue was touched for this sample.

Command:

```powershell
$avatarModelDir = Join-Path $env:TEMP 'pet-transparent-validation'
& (Join-Path $avatarModelDir 'venv/Scripts/python.exe') src/avatars/__tests__/rembg-synthetic.py --source test-results/avatar-live-20260914/avatar.jpg --model-dir $avatarModelDir --output test-results/avatar-live-20260914/rembg
```

Pinned `isnet-general-use` model SHA256 `60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a` was validated by the production worker. Inference took 7.315 seconds. Original RGB values and 1024 × 1024 dimensions were retained; 85.24% of pixels became fully transparent, with 14.76% carrying partial alpha. These mechanical checks passed.

**Manual quality failed:** white/dark full-image and actual-size crop inspection shows the entire torso, both arms and both feet removed. Only the head and a severely faded ribbon remain. The head also has a visible light rim against dark backgrounds. The original image clearly contains the missing parts. Sample interior alpha confirms complete removal:

| Original subject region | Mean output alpha, 0–255 |
| --- | ---: |
| Head center | 254 |
| Torso center | 0 |
| Left/right arm interiors | 0 / 0 |
| Left/right foot interiors | 0 / 0 |
| Ribbon region | 88.70 |

This is a concrete quality blocker for the current transparent path. `compose_alpha` accepts the mask because it contains both background and foreground pixels; its present numerical validation cannot detect missing anatomy or badly faded opaque decorations. The failure was reported to the parent immediately. The shared worker, model and migration were not changed or retried.

Evidence: `test-results/avatar-live-20260914/rembg/report.json`, `transparent.png`, `on-white.png`, `on-dark.png`, and `review-sheet.png`. The JSON marks `stage_acceptance_passed: false`. New helper `src/avatars/__tests__/rembg-synthetic.py` explicitly labels its automatic outcome as requiring manual review; it does not assert visual acceptance.

Required follow-up: resolve model/mask quality and reject or preserve the original on incomplete-subject results, then rerun visual review. A single furry synthetic sample does not cover translucent materials, unusual extra limbs, or every required pet sample class. The earlier brand-only rembg cloud loop remains separate evidence; this failed synthetic sample was not submitted to cloud storage/display.

## Persistent preview-confirmation protection

Before this fix, a successful derivative immediately replaced the visible pet portrait without review: the server defaulted `use_transparent` to true and returned a signed URL for any succeeded job; the hook exposed that URL and `app/(tabs)/pet.tsx` preferred it over the original. `pets.current_asset_id` remained intact, but the visible body changed automatically. The worker gateway validates format, dimensions and source hash, not complete anatomy.

The initial regression test reproduced unsafe selection (**1 failed, 1 passed**). It required a completed but unconfirmed derivative to leave `display.url` null; the old hook returned the head-only candidate URL. The final client suite now passes **15 tests**, including this regression, exact approval metadata, failed approvals, remount persistence, repeated enable, restore/re-enable, delayed responses after account/source changes, Realtime updates, subscription readiness, foreground and page reentry.

Implemented containment:

- The parent reviewed and installed migration `202609110018_pet_transparent_approval.sql` on both isolated instances. Four nullable approval fields bind confirmation to job, immutable source, display version and time within the owner/pet preference row. Existing results remain unapproved. Service-only `approve_pet_transparent` checks null/invalid inputs, owner/deletion state, current source, successful job, exact version and idempotent request payload. Approval preserves the generation version; restore/re-enable advances it and invalidates prior approval. Preference updates are published through Realtime under existing owner RLS.
- `pet-display` exposes a private `candidate_url` for review, while `url` is returned only for the exact approved source/job/version. Old clients therefore cannot automatically receive an unapproved main-image URL. Deleting accounts receive neither URL. After Storage signing, the server rechecks owner deletion, source and preference version and suppresses obsolete URLs when state changed during signing.
- `usePetDisplay` treats even an old server's unapproved `url` as a candidate and exposes the main URL only with matching approval metadata. Controls show light/dark candidate previews beneath the unchanged original body and require an explicit “使用此透明效果” action; “保留原图” restores the original preference. This records the owner's choice and does not claim anatomical correctness.
- Current-owner/current-pet Realtime updates trigger fresh status reads; initial `SUBSCRIBED` and PostgreSQL stream readiness revalidate missed events. Foreground/page reentry also refresh. Only pending processing jobs poll every five seconds; there is no fixed terminal-state polling. Background/blur, channel failure and failed status reads clear the displayed derivative. Responses are fenced to the current account/source and refresh sequence.
- The existing `worker-loop.mjs` entrypoint now checks candidate → explicit approval → display → restore. It was updated but not re-executed because this coordinated pass prohibited leasing the shared global transparent queue.

Validation of the final contract:

```powershell
npm test -- --runInBand src/avatars/__tests__/petDisplaySafety.test.ts
npx --yes deno check supabase/functions/pet-display/index.ts
& ./scripts/with-companion-env.ps1 -Script src/avatars/__tests__/approval-contract.mjs
& ./scripts/with-companion-env.ps1 -Fixture final-supabase-chain -Script src/avatars/__tests__/approval-contract.mjs
```

Client suite: **15 passed**. Final Edge Deno check: **passed**. Real Auth/RPC/Edge/Storage/Realtime contract: **36 passed on port 47321 and 36 passed on port 48321**, with all temporary accounts and objects cleaned up. These tests seed bundled-brand jobs and do not call an image provider, run rembg or lease global work. The exact Storage-signing race uses the actual source handler in-process with real Supabase I/O and an injected barrier, without starting another server. Restore/source/deletion during that barrier correctly suppresses stale response URLs. Existing signed URLs elsewhere still retain their bounded lifetime.

Reports: `test-results/avatar-live-20260914/approval-contract-47321.json` and `approval-contract-48321.json`. The parent runs final whole-repository typecheck/Jest and APK validation; this module does not claim a new physical-device or production-deployment result.

Frozen client SHA256: `e00b7e8d29ffc78b9e642aff4f4a5781e5bc705356a530115f327c954fc92475` (`src/avatars/petDisplay.tsx`). Frozen Edge SHA256: `8e158591fa33e060860cebfbe11d807f45a1cfc799c10df8db00fc01615ceb2d` (`supabase/functions/pet-display/index.ts`), synchronized to both local fixture sources.

Simple foreground-area thresholds cannot generally recognize missing limbs. The worker and pinned model were not altered or retried. **Preview confirmation prevents automatic misuse; it does not turn the observed rembg quality failure into a pass.**
