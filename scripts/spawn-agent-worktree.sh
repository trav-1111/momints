#!/usr/bin/env bash
set -e

# spawn-agent-worktree.sh
# Creates an isolated, zero-disk-overhead git worktree for autonomous AI agents.
# Usage: ./scripts/spawn-agent-worktree.sh <branch-name> [base-branch]

BRANCH_NAME="$1"
BASE_BRANCH="${2:-HEAD}"

if [ -z "$BRANCH_NAME" ] || [ "$BRANCH_NAME" = "--help" ] || [ "$BRANCH_NAME" = "-h" ]; then
  echo "Usage: $0 <branch-name> [base-branch]"
  echo "Example: $0 feat/kino-cadence v2-staging"
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE_DIR="${REPO_ROOT}/.worktrees/${BRANCH_NAME//\//-}"

echo "🚀 Spawning agent worktree for branch '${BRANCH_NAME}'..."
mkdir -p "${REPO_ROOT}/.worktrees"

# Add worktree
if git show-ref --quiet --heads "${BRANCH_NAME}"; then
  git worktree add "${WORKTREE_DIR}" "${BRANCH_NAME}"
else
  git worktree add -b "${BRANCH_NAME}" "${WORKTREE_DIR}" "${BASE_BRANCH}"
fi

# Symlink node_modules to avoid re-installing
if [ -d "${REPO_ROOT}/node_modules" ]; then
  ln -sf "${REPO_ROOT}/node_modules" "${WORKTREE_DIR}/node_modules"
  echo "🔗 Symlinked node_modules (0 extra MB)."
fi

# Copy VS Code config
if [ -d "${REPO_ROOT}/.vscode" ]; then
  cp -r "${REPO_ROOT}/.vscode" "${WORKTREE_DIR}/.vscode"
fi

# Copy AGENTS.md
if [ -f "${REPO_ROOT}/AGENTS.md" ]; then
  cp "${REPO_ROOT}/AGENTS.md" "${WORKTREE_DIR}/AGENTS.md"
fi

echo "✅ Worktree ready at: ${WORKTREE_DIR}"
echo ""
echo "To task an agent in this worktree:"
echo "  cd ${WORKTREE_DIR}"
echo "  npm run agent:check"
echo ""
echo "When finished, merge and clean up with:"
echo "  git worktree remove ${WORKTREE_DIR}"
