#!/bin/bash
# autotune-run.sh — one UNATTENDED tuning epoch (for cron/launchd; zero model tokens).
# Serves the build, runs one sweep, and if it improved commits the accepted params to the
# `autotune` branch (NEVER main, NEVER auto-deploys). A human or /autotune promotes from there.
# Safe by construction: fairness gate already enforced by autotune.mjs; work is on a branch.
set -e
cd "$(dirname "$0")"
LOG="autotune-cron.log"
echo "=== $(date) epoch start ===" >> "$LOG"

# 1) ensure a local server on 8642
if ! curl -s -o /dev/null http://localhost:8642/ 2>/dev/null; then
  (python3 -m http.server 8642 >/dev/null 2>&1 &) ; sleep 2
fi

# 2) run one epoch (exit 0 = improved & params.js patched; 42 = no change)
set +e
node autotune.mjs --budget 8 --sessions 6 >> "$LOG" 2>&1
CODE=$?
set -e

# 3) if improved, park it on the autotune branch (reviewable; never main)
if [ "$CODE" -eq 0 ]; then
  # verify all suites still green before recording (belt-and-suspenders vs the sweep gate)
  if node test.js >/dev/null 2>&1 && node fun_test.js >/dev/null 2>&1 && node combat_test.js >/dev/null 2>&1 && node boss_test.js >/dev/null 2>&1; then
    git stash -q 2>/dev/null || true
    git checkout -q -B autotune 2>/dev/null || git checkout -q autotune
    git stash pop -q 2>/dev/null || true
    git add params.js AUTOTUNE_LEDGER.md
    git -c user.name="autotune" -c user.email="brighamhall@gmail.com" commit -q -m "autotune: params improved ($(date +%F))" || true
    git checkout -q main 2>/dev/null || git checkout -q -
    echo "improved -> committed to autotune branch" >> "$LOG"
  else
    echo "REJECTED: a suite went red post-sweep (should not happen); discarding" >> "$LOG"
    git checkout -q params.js
  fi
else
  echo "no change (exit $CODE)" >> "$LOG"
fi
echo "=== $(date) epoch end (code $CODE) ===" >> "$LOG"
