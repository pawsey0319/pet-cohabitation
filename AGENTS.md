# Project continuation instructions

Read `docs/handoff/START-HERE.md` first, then `docs/handoff/ENVIRONMENT.md` and the linked current release/acceptance record. These files are the cross-device handoff; the original conversation and ignored `test-results` directories are not required for ordinary development.

- Active implementation branch: `codex/agent-workbench-pet-onboarding`. `main` and other historical branches are older; do not replace current files with an old worktree snapshot.
- Preserve work already present. Confirm `git status` before edits. Do not bulk reset or clean to reproduce an old state.
- Keep credentials, sessions, signing keys, model gateway configuration/auth directories, user data, build caches and temporary environment files out of Git. The tracked Firebase Android client configuration is public app configuration, not a server service-account credential.
- Do not replay historical production rollout scripts. September 22 migrations 001–004 are already deployed. Add a new migration for future database changes; never modify those deployed files in place.
- Android 1.0.9 build11 uses runtime 1.0.9; OTA is limited to compatible JavaScript/assets. Review native modules/dependencies/runtime before publishing. No new paid resources or native dependencies were authorized by the latest feature plan.
- Keep phone acceptance, Windows remaining checks, free cloud feasibility and real multi-day trials separate from automated checks. Never mark them passed without their own evidence.
- Group observation consent is separate from operation authorization. Ordinary pet writes require concrete preauthorization; permissions/account export or deletion/formal appearance changes retain owner confirmation. Image understanding/original-image editing remain closed until actually verified.
- Restarting the AI tunnel changes shared cloud model endpoints. Cloning or running local checks is not a reason to restart it or stop the old workstation. See the environment handoff before moving live workers.
- After meaningful completed work, commit and push the intended development branch and update handoff/release evidence; a cloud deployment does not itself upload source to Git.

## Multi-model collaboration (owner instruction)

- When a second opinion, independent critique, adversarial check, or external model pass would help the current task, use `$call-grok`.
- Do not hard-code or auto-pick a Grok model version.
- Before each call, ask the owner which model name/ID to use for this call. A choice for a previous call does not authorize a new call.
- After the owner chooses, use the installed skill's `call_grok.py` with `--model`, `--task`, `--role` and `--context`. Derive the role from the current task; do not use a fixed persona. On Windows the usual skill path is `$env:USERPROFILE/.codex/skills/call-grok/scripts/call_grok.py`; install/configure it separately on a new device if absent.
- Grok output is advisory. Prefer local source and reproducible verification when they disagree. Never put credentials or real private user content in its context.
