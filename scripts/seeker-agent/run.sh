#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "========================================================="
echo "   Momints Autonomous Seeker QA Agent & Auditor"
echo "========================================================="

python3 "${SCRIPT_DIR}/runner.py" "$@"
