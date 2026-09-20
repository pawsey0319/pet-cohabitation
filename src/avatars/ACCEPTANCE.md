# T03/T04 implementation and acceptance · 2026-09-11

> Current follow-up: [2026-09-14 mobile feedback fixes](../../docs/implementation/2026-09-14-mobile-feedback-fixes.md). The retained furry sample's missing-body regression is fixed with the same pinned model and original RGB; the real worker is running and 13 local / 12 cloud delivery-and-approval checks passed. Broader image-class quality and physical Android acceptance remain open. The older failed sample below is retained as historical evidence, not the current output.

Implemented locally: branded bundled Android icon/light-dark splash and runtime 1.0.5/6; personal photo crop/preview/apply/reset and AI avatar draft UI; private image assets and versioned idempotent application; owner-only custom group images; stable member mosaics; shared 12/day avatar-background design claims; cloud job leases and immutable original pet images; pinned rembg worker; export/deletion helpers.

**2026-09-14 follow-up:** see [LIVE-ACCEPTANCE-20260914.md](./LIVE-ACCEPTANCE-20260914.md). One real configured-provider avatar passed 35 worker/data/Edge-read/apply checks. A new synthetic furry rembg sample failed visible anatomy/edge quality. Persistent preview confirmation now prevents automatic application of unreviewed transparent results (15 client checks and 36 real approval contracts on each isolated instance). This protection does not make transparent quality pass; T04 remains unaccepted. The dated evidence below describes the earlier baseline.

## Evidence

- `npm run typecheck` passed after avatar/editor/worker hooks were added and again after the T12 integration. Parent handles final whole-repository checks.
- `npm test -- --runInBand src/avatars/__tests__/avatars.test.ts`: 2 tests passed.
- Python `test_worker.py`: 3 tests passed, covering RGB preservation, existing translucency, real alpha, empty/opaque mask rejection and model-file validation.
- `& ./scripts/with-companion-env.ps1 -Script src/avatars/__tests__/supabase.mjs`: 31 checks passed on the complete isolated Supabase instance. Includes real Edge photo registration/retry, immutable storage upload, private-draft denial, shared applied avatar read, owner-only group changes, stale version, shared quota, revoked membership, leases and restore-vs-late-commit.
- `& ./scripts/with-companion-env.ps1 -Script src/avatars/__tests__/worker-loop.mjs`: passed the actual pinned rembg model -> worker credential -> authorized cloud lease -> private Storage -> guarded commit -> display -> restore path. It confirms system repair consumes no personal image quota and preserves `pets.current_asset_id`.
- The inference input was the bundled brand fixture. It is not evidence of pet hair, fine decorations, multiple limbs, or translucent details passing quality review.
- Grok model explicitly selected by the user: `grok-4.6-high`; one call completed. It returned design advice and explicitly had no filesystem/code access. Adopted ACL, fencing, immutable originals and startup readiness guidance; not recorded as independent code acceptance.

## Runtime and model

`transparent-worker/requirements.lock` pins all resolved Python dependencies and artifact hashes for Python 3.13. Core runtime: rembg 2.0.67, onnxruntime 1.22.1, Pillow 11.3.0, NumPy 2.2.6.

`model.lock.json` records upstream MD5 `fc16ebd8b0c10d971d3513d564d01e29` and independently calculated SHA256 `60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a` for the 178,648,008-byte `isnet-general-use.onnx` download. Both checks passed before inference.

Install into a dedicated Python 3.13 environment with `uv pip sync requirements.lock --require-hashes`. Place the verified model in a separate model directory. Configure `PET_TRANSPARENT_WORKER_URL` as the cloud function URL and `PET_TRANSPARENT_WORKER_TOKEN` with a dedicated 32+ character secret shared with that function. `PET_TRANSPARENT_PUBLIC_URL` optionally supplies the externally reachable Supabase origin for an isolated local fixture. No service-role key is needed on the worker computer.

Run `python worker.py --model-dir <verified-model-directory>`. `--once` handles at most one job; `--verify-model` validates files without receiving work. Logs contain only status/error codes. Input processing runs in a time-limited subprocess; the model only supplies a mask, which multiplies original alpha while retaining original RGB values. Generated derivatives remain private in cloud Storage after the computer stops.

## Integration

- `AvatarImage({reference,name,size})`, `GroupAvatar({reference,members,name,size})`, `SpaceAvatar({spaceId,name,size})`.
- `AvatarEditor({visible,onClose,target?,onApplied?})`; target defaults to the signed-in profile. Group edits use `{kind:'space',id}` and server owner checks.
- `BrandSplash({ready})` waits only for local session/theme hydration and a rendered frame. Parent integrates root readiness.
- `usePetDisplay(petId,currentAssetId)` provides the optional transparent URL; use `display.url ?? originalUrl`. `PetDisplayControls({display})` provides requests and original restore.
- `_shared/avatarData.ts`: `exportAvatarData` and `deleteAvatarData`; deletion precedes the existing background cleanup. No avatar drafts or signed URLs persist to local storage.
- Main integrator owns Realtime publication changes for profiles, space members and avatar bindings.

## Still required before stage acceptance

- New APK build/install and Android cold-start, theme-transition, keyboard and avatar picker testing on a real target device.
- Live AI avatar generation against the configured provider; mock mode is explicitly rejected by this function.
- Real multi-account visual confirmation and real pet detail/alpha-edge acceptance across the required sample classes. The automatic alpha check cannot detect missing limbs or every dirty edge.
- Production migration/function/worker configuration and cloud account deletion/operational recovery verification. No production deployment or release was performed by this module.
- AI-avatar leases recover on generation/status requests; autonomous cloud retry scheduling is not yet configured. The transparent worker loop independently polls queued jobs.
- Signed URLs already issued have a bounded remaining lifetime (avatar 120 seconds); database permissions are revoked immediately. Screens must unmount related display state on logout/leave as the shared chat implementation does.

T03 and T04 are implemented with local evidence; neither phase is marked fully accepted or released.
