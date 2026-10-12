# Codex brief — commit, push and build the submission candidate

Prepared: 1 October 2026. Execute steps 1–3 of the agreed release workflow. This document is preparation only; it does not establish that a branch was pushed or an APK built.

## Objective and authorization

Create `codex/submission-candidate` from the current verified working branch, commit the reviewed cleanup and rights notice, push only that candidate branch to the existing private GitHub repository, and build a signed standalone Android APK from its exact committed state.

The owner explicitly authorizes local branch creation, explicit staging, commits and the candidate-branch push in this task. This supersedes the earlier cleanup brief's prohibition on those actions. Preserve existing commits and competition history. Leave `hackathon` and `main` unchanged until candidate testing succeeds in a later task.

Stop after delivering the APK and build evidence. Do not install it, run paid tests, merge into `hackathon`, publish a release, change repository visibility or deploy the Worker. Read-only device inspection to check existing package/signing compatibility is allowed; preserve all app, wallet, history and vault data.

## Starting context

- Workspace: `D:/Claude/momints`. Read applicable instructions, inspect the actual branch/status and preserve existing worktrees and local files.
- At preparation, current branch was `fix/roll-frame-contract`, HEAD `ede938d`. The verified feature changes are committed; formatting, setup/docs, exclusions and license notices are still working-tree changes. Reconfirm before acting.
- Origin: `https://github.com/trav-1111/momints`. The owner chose private repository access for judging; making it public later remains a separate decision.
- Read `docs/SUBMISSION-REPOSITORY-CLEANUP-REPORT.md` and its private grouped change ledger. Cleanup recorded 141 formatting warnings reduced to zero, 83 app tests and 32 Worker tests passing, and a verified 302-file clean snapshot. The later rights notice and documentation edits are not included in that original snapshot; build from the new committed tree instead.
- The owner retains rights. Include `LICENSE.md` and its README/reviewer references; preserve separate third-party and filmstock terms. Do not introduce MIT or another open-source grant.
- Private authoring files remain ignored and unchanged: `.claude/settings.local.json`, `worker/filmstock-drafts/`, `worker/scripts/make-bali-starter-contact.mjs`. `.expo/` evidence/corpus, Worker private evidence, exports and credentials also stay excluded.
- Two local `refs/codex/turn-diffs/checkpoints/...` tree refs reach private drafts. Never mirror-push, push all refs, publish the whole `.git` directory or upload the entire working directory.

## Step 1 — create the candidate branch

1. Inspect current status, branch ancestry, remote URL and existing candidate branches locally/remotely. Preserve a recoverable baseline of intended uncommitted edits privately; never include secret files in a patch.
2. Confirm GitHub repository visibility using authenticated read-only metadata. If visibility cannot be verified, complete local commits/build preparation and report the missing access check before pushing. If the repository is public, do not push private-intended changes or silently change visibility; report that actual conflict with the owner's plan.
3. Create `codex/submission-candidate` at the current verified feature HEAD, carrying the intended working-tree cleanup edits. Do not start from the older `hackathon` tip and lose feature commits. Do not move the `hackathon` or `main` refs.
4. If a candidate branch already exists, inspect and reuse it only if it belongs to this task and contains the required baseline. Preserve divergent work. Never reset, delete or force-update an existing branch merely to reuse the name.
5. Preserve other branches and attached worktrees. Branch pruning and worktree deletion are outside this task.

## Step 2 — review, commit and push explicitly

1. Reconcile the actual diff with the cleanup report/ledger, including subsequent rights-reserved edits and this brief. Distinguish mechanical formatting from setup/docs/exclusions and focused reviewer-safety tests. Line-ending-only status entries need not become noisy commits.
2. Audit the exact outgoing branch content and intended additions for secret/private-file exposure. Reuse the existing audit evidence where still applicable, but check newly added files and any new commits. Print only redacted findings. Keep approved production filmstock assets/source LUTs included and byte-identical.
3. Stage explicit reviewed paths or hunks. Do not use blanket `git add .`, `git add -A` or automatically stage every untracked file. Ensure sanitized examples are included while real `.env`, `.dev.vars`, signing files and evidence are excluded. No accidental gitlinks/worktree files.
4. Use separate commits for:
   - Mechanical formatting of maintained files.
   - Reviewer setup/docs, precise exclusions and reviewer-safety tests.
   - Rights-reserved notice/documentation, if a separate commit improves review.
     Include the cleanup report and execution briefs in the appropriate documentation commit. Do not mix runtime changes into the formatting commit. Preserve all earlier feature commits; no squash, amend or rebase.
5. Prepare any reproducible APK build configuration/script or necessary version-code adjustment before the final source freeze, in a clearly described additional build commit. Preserve `com.momints.app`, the existing app identity and established signing configuration. Do not change version numbers blindly or regenerate lockfiles/dependencies.
6. Run final source checks after the commits/build configuration are complete: repository-wide Prettier, app typecheck/lint and maintained app suites. Run affected Worker tests/typecheck/catalogue validation if their inputs changed. The documented frozen Worker install is `npm ci --legacy-peer-deps`; root install uses `npm ci`. Do not describe a partial run as full CI. Reuse completed cleanup checks where their tested inputs are unchanged.
7. Verify intended source/configuration/docs are committed, staging is empty and the remaining local files are ignored/excluded. Check Git whitespace and private-file exclusions. Do not delete unrelated files to obtain a clean status.
8. Push only this branch with an explicit refspec, for example `git push -u origin HEAD:refs/heads/codex/submission-candidate`, after confirming HEAD is the candidate. Never use `--mirror`, `--all`, `--tags` or force-push. Verify the remote branch SHA matches the intended commit. Do not push `hackathon` or `main`.

## Step 3 — build the signed standalone APK

### Source and configuration

- Build from a fresh private local export/checkout of the exact committed candidate tree, ideally isolated from the owner's existing generated Android project. Export only that commit's source; do not copy checkpoint refs, evidence, private corpus or the entire working directory.
- Install locked dependencies and regenerate the Android project in that build workspace using the installed compatible Expo tooling. Preserve custom `camera-caps`, `camera-manual` and `film-gl` native modules, plugins and assets. Do not prebuild-clean the owner's original checkout.
- Use `EXPO_PUBLIC_ROLL_API=https://api.momints.xyz` and the existing treasury `o4w1THGTu1ufcRUEpVn45zttpcPoQBFFSLtMYeu5HpW`. Use the existing client-appropriate mainnet RPC configuration; an `EXPO_PUBLIC_*` RPC endpoint is embedded in the APK. Do not put backend funding keys, operator tokens, webhooks or keystore credentials into public app variables.
- Read required local environment values without printing them. Use only app-side variables in the build; do not copy a Worker secret file wholesale. Inspect the resolved configuration carefully, redacting credential-bearing URLs from logs/reports.
- Produce an actual release **APK**, with JavaScript/assets embedded and no Metro requirement. `npm run android:build` only prebuilds native code. The existing EAS production profile requests an AAB; the preview profile requests an APK with local credentials. Neither configuration alone is evidence of a completed standalone build.

### Signing and build method

- Prefer a local Windows-compatible native release build using the project's Gradle wrapper (`app:assembleRelease`) in the isolated generated Android workspace. Follow the current project and [Expo release-build guidance](https://docs.expo.dev/guides/local-app-production/) rather than assuming the generated release variant has correct signing. Check existing signing configuration explicitly.
- Reuse the existing Android release signing identity and secure local credential material. The Android signing key is separate from the Solana backend wallet. Never generate/rotate a replacement, substitute a debug key or print passwords/private-key contents merely to finish the task.
- If signing material is unavailable, finish all source commits, permitted push and build preparation, then request only the missing secure credential action. Do not ask the owner to paste private signing values into chat.
- Prefer local building; do not upload source, credentials or private workspace content to a cloud builder as a silent fallback. If local building truly cannot proceed, explain the concrete prerequisite and prepare a scoped alternative for the owner.
- Persist only non-secret reusable build configuration in Git. Keep keystores, credentials, local environment, build logs and outputs in correctly ignored/private locations. Required generated signing configuration must be reproducible from committed scripts/configuration plus documented private inputs, not unexplained manual source patches.
- Check candidate package/version and signing-certificate compatibility with the installed Seeker app if the device is available. A debug-installed app may have a different certificate from the release APK. Record that explicitly; do not change the release identity, uninstall the app or clear data to hide an installation conflict.
- If a build failure requires a source/configuration fix, make the smallest fix, validate and commit it on the candidate, then push that new tip and rebuild from that exact commit. Do not claim the APK matches a pushed commit while it contains uncommitted build fixes.

### Artifact verification and provenance

1. Verify the final APK with Android build tools: signature/certificate, package `com.momints.app`, version name/code, release/non-debuggable status, intended ABI support including Seeker arm64, and embedded application bundle/assets.
2. Inspect packaged configuration and merged permissions for the expected API/treasury and required wallet/camera/native modules. Check for accidental backend/signing secrets and development-only runtime requirements without dumping the client RPC key. Static inspection establishes build properties; device behavior remains unverified until the next task.
3. Compute SHA-256 and byte size. Save the APK in an ignored local output path such as `.expo/submission-candidate-apk-20261001/`, with a filename including the short source commit. Do not commit the binary or publish it to GitHub Releases.
4. Record privately: full source commit, tree hash, remote branch SHA, APK path/hash/size, signing certificate SHA-256, package/version/ABI details, Node/npm/JDK/SDK/Gradle versions, build command, sanitized app configuration and any external build inputs. Never claim the APK hash is reproducible solely from a commit; signing/toolchain/environment inputs matter too.
5. Keep build logs and the provenance report in that ignored output directory. Avoid post-build source/doc edits that obscure which remote commit produced the APK. Any later documentation-only commit must be identified separately from the APK's source commit.

## Required final handoff

Report the remote candidate branch link and full commit, grouped commit summaries, GitHub private-visibility verification, successful checks, APK download/local file link, SHA-256, signing fingerprint, package/version and static-verification results. State whether in-place installation on Seeker should be compatible or requires an explicit owner decision.

Use the status: **Signed standalone candidate APK built; ready for Seeker testing without Metro.** Only use it if the build/signature checks passed. Otherwise state the exact remaining dependency without overstating completion.

Device installation, cold-start/no-Metro testing, wallet/camera/history/contact-sheet smoke tests and final merge into `hackathon` belong to the next step. No paid test, production deployment, branch merge, public visibility change or binary publication occurred in this task.
