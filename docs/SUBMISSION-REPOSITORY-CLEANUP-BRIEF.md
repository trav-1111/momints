# Codex brief — submission repository and formatting cleanup

Prepared: 1 October 2026. This is an execution brief; writing it did not perform the cleanup.

## Objective

Execute the first two remaining submission-readiness steps: resolve the repository-wide Prettier baseline and make the source repository clear, safe to share and reproducible for hackathon reviewers. Complete the authorized local fixes and validation, then deliver a concise report. APK production, demo/pitch authoring and publication are separate tasks.

Work in `D:/Claude/momints`. Read applicable repository instructions and preserve existing work. The owner created a competition branch to show work during the hackathon; retain the commit history and provenance. Do not rebase, squash, amend, reset, recreate the repository or rewrite history. Do not commit, stage, push, merge, create a PR, change repository visibility or deploy anything in this task.

## Verified product baseline to preserve

- Quick, 12-frame and 24-frame owner tests completed. Independent verification matched 36/36 Arweave image hashes and 36/36 Core asset owner/collection relationships. Both collection authorities belong to the shooter, Worker delegates are revoked and developed markers verified.
- The Seeker cleanup audit found no retained user photographs, encrypted roll frames or decrypted temporary files. The saved 25/24 count repaired to 24/24 and survived two cold restarts; the complete 63-item history stayed byte-identical.
- The owner accepted the Seeker debug memory envelope: total PSS at most 1 GiB, Graphics at most 256 MiB, settled Graphics within 10 MiB of baseline after five seconds. Recorded peaks were 870.8 MiB / 227.9 MiB, returning exactly to the 34.4 MiB Graphics baseline.
- Real 12-frame Resume Roll Mint recovery and prior restart/offline/torn-manifest tests are recorded. Do not turn this cleanup into another paid test or claim unperformed automatic-recovery scenarios passed.
- Keep image allowances, quality ladder, pricing, minting, recovery and privacy behavior unchanged. Production runs at `https://api.momints.xyz` using preserved production resources and credentials.

Read the latest production checklist, cutover report and hackathon presentation notes before editing their status. Private evidence remains ignored and undeployed, including `.expo/completed-roll-verification-20261001/report.json`.

## Settled disposition of uncommitted authoring files

Inspected on 1 October 2026. The following files are not required to build or run the current app. Preserve them locally in place; do not delete, move, reformat, commit, deploy or include them in the clean submission snapshot.

| Path                                           | Purpose                                                                                                                                      | Required handling                                                                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/settings.local.json`                  | Local Claude configuration                                                                                                                   | Add the exact file to Git and formatter exclusions. Preserve existing `.claude/skills` and `.claude/worktrees` exclusions; do not delete or blanket-hide unrelated project instructions. |
| `worker/filmstock-drafts/`                     | Private authoring workspace: editable GIMP/Resolve projects, reference photographs, conversion tools, source copies and intermediate exports | Exclude this directory from Git, formatting and submission packaging. Preserve it for future filmstock work; do not treat it as disposable build output.                                 |
| `worker/scripts/make-bali-starter-contact.mjs` | Local comparison-sheet helper with hardcoded paths into the private photo corpus                                                             | Exclude this exact script from Git, formatting and submission packaging. Retain it locally as an authoring tool.                                                                         |

Add these narrowly scoped patterns to `.gitignore` and `.prettierignore` before running broad formatting:

```gitignore
/.claude/settings.local.json
/worker/filmstock-drafts/
/worker/scripts/make-bali-starter-contact.mjs
```

The approved Bali and Martha source LUTs are already tracked under `worker/filmstock-sources/`; both matched their corresponding draft copies byte-for-byte at inspection. Production recipes, runtime LUTs and previews are separately tracked under `worker/filmstock-assets/`. Keep these maintained directories, source attribution and required publishing/validation scripts in the submission. Do not broaden the draft exclusion to either directory or regenerate their immutable assets.

Verify the exclusions with Git's ignore checks and confirm these paths remain untracked. Record that their contents were preserved. Private QA evidence must also remain ignored, not merely uncommitted. These decisions are settled; further cleanup should focus on the other repository candidates rather than reconsidering publication or deletion of these authoring files.

## 1. Inventory and establish a reviewable baseline

1. Inspect the current branch, local Git history, remotes, worktrees and tracked/untracked changes. Do not assume this checkout contains only your task's work. Capture changed-file names and a recoverable baseline for existing edits, including intended untracked source/test files, in an ignored local location. Keep secret-containing files out of patches and reports.
2. Run the installed formatter's check and record the actual affected file count. Previous reports of 130/131 files are historical, not a current measurement. If the global npm launcher is broken, use a working local/runtime invocation rather than reinstalling tools or changing dependencies just to launch a check.
3. Distinguish tracked app/Worker source, docs, tests and configuration from generated outputs, local evidence, private drafts, old experiments and immutable assets. Keep a change ledger so the owner can later review/commit formatting separately from documentation, exclusions and any justified removals. Do not create those commits in this task.

## 2. Resolve the formatting baseline

The owner now authorizes a repository-wide formatting-only cleanup. The earlier instruction to defer that rewrite no longer blocks this dedicated task.

- Review `.prettierignore` and the formatter's actual input set before applying changes. Prettier and Git exclusions serve different purposes; do not assume Git-ignored material is automatically skipped by `prettier --write .`.
- Apply the settled authoring-file exclusions above, then review additional generated/native build output, dependency/vendor trees, private evidence and local credentials for narrowly scoped exclusions. Keep excluded local material intact.
- Preserve exact bytes of hash-addressed/versioned filmstock assets, catalogue packages, signed artifacts and fixtures whose byte content is part of a contract. Do not reformat them or recalculate hashes to make the check pass. If a formatter recognizes such files, document precise exclusions consistent with package validation.
- Format maintained, formatter-supported source, tests, docs and configuration using the installed project version and existing style. Do not exclude application source or whole maintained subprojects merely to silence warnings.
- Keep formatting edits mechanical: no dependency upgrades, refactoring, API changes, feature edits, lockfile regeneration, branch restructuring or native project regeneration disguised as cleanup.
- Inspect the diff for behavioral edits. If a substantive defect is discovered, record it separately; fix only what is necessary for the repository/setup scope, keeping that patch distinguishable from formatting.
- Finish with the actual repository `fmt:check` passing, not just a check restricted to the files you happened to edit. Explain each new exclusion.

## 3. Review source hygiene and obsolete material

The owner suspects old code from an early EAS build. Age, a filename or an unused-looking directory alone is not proof that it should be deleted.

- Trace candidate references through imports, scripts, app configuration, EAS/build profiles, native module configuration, CI and docs. Check tracked status and explain whether each candidate is required, useful historical context or genuinely obsolete.
- Specifically review `eas.json`, early Worker/spike directories, prototype utilities, old endpoint references and generated build artifacts if present. Do not remove current EAS configuration simply because an earlier EAS build was used. Do not remove `src/services/ipfs.ts` just because its name predates the Turbo migration; establish its actual callers.
- Keep useful architecture experiments as clearly labelled historical material or index them from current documentation. Preserve hackathon provenance and existing worktrees. No bulk deletion of old branches, worktrees or experiment directories.
- Remove confirmed obsolete tracked files locally only when dependency/reference checks support it and recovery is available. List every removal and its justification. Preserve ambiguous or unpublished untracked material; exclude private scratch files narrowly rather than deleting them.
- Verify the current source snapshot contains the roll-registry fix and its tests, even if still untracked/uncommitted. Do not let cleanup accidentally omit the tested application changes from the eventual submission.

## 4. Check secrets, private evidence and submission contents

- Audit tracked files, intended additions and relevant reachable Git history for actual credential/private-content exposure using suitable local tooling. Review false positives; public wallet addresses, transaction IDs and example placeholders are not secrets.
- Never print secret values, private photo contents or credential-bearing URLs. Findings should contain file/path or commit location, credential category and a redacted description only. Do not upload code or private evidence to a third-party scanner.
- Verify appropriate Git exclusions for `.env` variants with real credentials, Worker `.dev.vars`, signing material, `.expo/` evidence/corpus/comparisons, Worker evidence/secret directories, exports, build outputs, local agent files and private film drafts. Preserve sanitized environment examples and required source assets.
- Check both tracked status and ignore behavior. Adding an ignore pattern does not untrack existing files or remove them from history. If an actual credential is found in reachable history, report the publication blocker and complete unaffected work; do not automatically rotate keys or rewrite history. Existing production credentials must not be changed by this task.
- Keep public presentation statements separate from private evidence. Public docs may summarize verified results; the private report and photographs must remain excluded. Remove inappropriate machine-specific secrets/recovery details from public setup instructions while retaining necessary local operational documentation safely.

## 5. Make setup reproducible for a reviewer

The current root README contains concrete issues to resolve: a `YOUR_USERNAME` clone URL, instructions to ask the owner for their `.env`, and a script table that does not fully describe the current checks. Inspect the actual repository before revising these.

1. Derive the repository URL from the verified remote, without exposing embedded credentials. Do not invent a URL or claim the repository is public. Record visibility/publication verification as pending if access cannot be established.
2. Document prerequisites from the current lockfiles/configuration: compatible Node/package manager, Android/JDK/SDK setup, physical-device requirements, wallet/MWA and the native-module build flow. Confirm version requirements from project evidence or official documentation where necessary; do not copy stale prerequisites uncritically.
3. Supply sanitized environment examples with clear required/optional fields. Explain how to obtain one's own RPC access and distinguish public app configuration from private backend secrets. A reviewer should not need the owner's private `.env`, signing wallet or operator token.
4. Explain the two supported setup choices accurately: running the app against the existing public API where available, and provisioning a separate backend using the documented bindings, migrations and one's own credentials. Do not direct reviewers to run production deployment, retirement, activation or synthetic-data tooling against Momints' production resources.
5. State mainnet requirements and which actions spend funds. Do not promise free/devnet minting or provide a funded owner credential. Clearly distinguish a Metro-dependent development build from a standalone APK; APK creation is outside this task.
6. Review README feature claims, current API links, scripts, project layout, license attribution and active setup links. Label historical docs/examples rather than globally replacing every old URL in evidence records. Do not invent license grants for assets or delete attribution.
7. Validate clean-source setup in a separate disposable directory using an exact snapshot of intended submission files, including authorized uncommitted/untracked source fixes, while excluding local secrets, evidence and installed dependencies. Do not use a clone of HEAD alone if that omits the changes being submitted. Install from lockfiles using frozen/reproducible commands and run the documented non-spending checks there. Record exactly what was tested and any external prerequisites still needed. Do not clear or replace the working checkout or Seeker app data.

## 6. Validation and completion criteria

- Repository-wide formatting check passes with justified exclusions; no private/immutable content was modified by formatting.
- App typecheck, lint and relevant existing test suites pass, including registry, reconciliation, privacy and vault tests. Run maintained app suites once after the final changes; do not repeat paid tests.
- Worker typecheck, contract/package/catalogue checks and affected deployment-tooling tests pass if their files/configuration were touched. Run a dry-run bundle if Worker build inputs changed. Do not run mutating deployed suites, migrations or remote deployment commands for this cleanup.
- Dependency manifests and lockfiles stay consistent. Diff/whitespace checks pass. Explain any genuine pre-existing failure rather than disabling a check to get a green result.
- README instructions were checked against the clean snapshot. Full Android build/prebuild is not automatically required just because the existing `ci` script includes it; report which CI components ran and leave standalone APK production to the next task. Never claim full CI passed when only a subset ran.
- No live backend, wallet, production data or device history was changed. No payment, mint, permanent upload, notification, commit, push, merge or publication occurred.

Create `docs/SUBMISSION-REPOSITORY-CLEANUP-REPORT.md` containing:

- Before/after formatting counts and the final check result.
- File groups for formatting-only changes, setup/docs/configuration changes and removals, with exclusion/removal rationale.
- Sanitized secret/private-file audit results, scan coverage and any unresolved publication blockers.
- Confirmation that the three settled local-only paths remain present, untracked and ignored, while approved filmstock sources and production assets remain included and unchanged.
- Clean-source setup steps and results, including verification limits.
- Exact validation results and remaining submission tasks.

Update the production checklist only for gates actually completed, and add a concise, accurate note to the hackathon presentation notes if useful. End with a reviewable diff and a recommendation for the subsequent standalone APK task. Do not leave ordinary authorized formatting or documentation fixes as suggestions; finish them.
