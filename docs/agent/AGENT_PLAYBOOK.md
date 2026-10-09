# Momints Agent Playbook & Operational Protocol

> **Purpose:** Standard Operating Procedure (SOP) for autonomous AI agents working in this repository.  
> **Goal:** Ensure every new agent instance bootstraps immediately, preserves all prior verified progress, and appends structured state without starting from scratch.

---

## 1. Fast Bootstrap Protocol (First 60 Seconds of Any Task)

When an agent enters this repository, it MUST execute the following 3 steps before writing any code:

### Step 1: Run Fast System Health Check
```bash
npm run agent:check
```
* **Success:** TypeScript passes (0 errors), 38 core unit tests pass (< 1s).
* **Failure:** If this fails before you touched anything, fix the baseline failure first or identify the broken commit.

### Step 2: Read Ground Truth State
1. Read [`docs/agent/HANDOVER_LEDGER.md`](file:///Users/zaac/momints/docs/agent/HANDOVER_LEDGER.md) (latest session entry at top).
2. Read [`docs/agent/INVARIANTS.md`](file:///Users/zaac/momints/docs/agent/INVARIANTS.md) (non-negotiable rules).
3. Check git branch and remote status:
   ```bash
   git status
   git log -n 3 --oneline
   ```

### Step 3: Identify Domain & Boundaries
* If modifying camera / UI / client logic: work in `src/` or `modules/`.
* If modifying Worker / contracts / backend: STOP. Review Section 1 of `INVARIANTS.md` and check if Trav sign-off is required.

---

## 2. Development & Editing Rules

1. **Maintain Invariant Compliance:** Check your design against [`docs/agent/INVARIANTS.md`](file:///Users/zaac/momints/docs/agent/INVARIANTS.md) (e.g. Ed25519 signature slicing, atomic storage migration, fee verification).
2. **Never Fabricate Hardware Verification:** Distinguish clearly between:
   * **Unit/Mocked Test:** Passing in Node.js test harness.
   * **Real Hardware Test:** Verified on physically attached Solana Seeker via ADB.
3. **Keep Commits Atomic:** Write clear commit messages detailing *why* a change was made and which edge cases were closed.
4. **Push Only to `zaacishere`:** Never push directly to `origin` (`trav-1111`).

---

## 3. Handover & Completion Protocol (End of Every Task)

Before completing your session, you MUST:

1. **Run Full Verification:**
   ```bash
   # 1. Fast check
   npm run agent:check

   # 2. Worker typecheck & contract tests (if worker touched)
   npm --prefix worker run typecheck
   npm --prefix worker run test:roll-contract
   ```
2. **Append Session to [`docs/agent/HANDOVER_LEDGER.md`](file:///Users/zaac/momints/docs/agent/HANDOVER_LEDGER.md):**
   * Prepend a new session entry following the standard schema (Date, Author, Scope, Verified Truth, Open Tech Debt, Next Actions).
3. **Commit & Push to `zaacishere`:**
   ```bash
   git add <modified files>
   git commit -m "..."
   git push zaacishere <branch-name>
   ```
4. **Output Handover Card:** Output a concise, factual summary for the user with:
   * Current branch & commit SHA
   * What was tested & verified
   * What remains open
   * The copy-paste prompt for the next agent.

---

## 4. Copy-Paste Bootstrapping Prompt for Any Incoming Agent

Drop this prompt into any new agent (Codex, Claude Code, Cursor, Antigravity) to instantly prime it:

```markdown
You are working on the Momints codebase (/Users/zaac/momints).
Before making any changes or answering architectural questions:
1. Run `npm run agent:check` to verify the baseline health.
2. Read `docs/agent/HANDOVER_LEDGER.md` for the latest verified state and open issues.
3. Read `docs/agent/INVARIANTS.md` for non-negotiable architectural rules (remote push restrictions, Ed25519 signature slicing, atomic storage migration, Seeker camera HAL).
4. Strictly follow `AGENTS.md` and `docs/agent/AGENT_PLAYBOOK.md`.
```
