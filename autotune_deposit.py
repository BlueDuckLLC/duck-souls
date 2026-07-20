#!/usr/bin/env python3
"""autotune_deposit.py — the bridge from the DUCK SOULS autotuner to the fleet's REAL
autoresearch memory. Deposits an accepted tuning/feature change as a conjecture in the
canonical hypotheses.db via the fleet helper (never touches the db directly), or parks a
rejected one. This is what makes the AI-scientist loop COMPOUND across runs.

Usage (called by the /autotune skill after grading):
  autotune_deposit.py deposit --key mutroll-0813 \
      --claim "raising room.mutRoll 0.65->0.73 lifted funProxy 0.30->0.40" \
      --grade A --refuters 3 --holdout PASS --keep "funProxy up + fun_test green + holdout"
  autotune_deposit.py park --key foo --claim "..." --reason "adversary: metric artifact"
"""
import argparse, sys
from pathlib import Path

HELPER = Path.home() / "org-engine/data-science/scripts"
HYP_DB = Path.home() / "org-engine/data-science/hypotheses.db"
LEDGER = Path.home() / "org-engine/data-science/autoresearch_graded.jsonl"
PARKED = Path.home() / "org-engine/data-science/autoresearch_graded_parked.jsonl"
sys.path.insert(0, str(HELPER))
import autoresearch_grade as ar  # the fleet's real deposit/park/grade helper


def candidate(a):
    return {
        "key": a.key,
        "title": f"duck-souls autotune: {a.key}",
        "claim": a.claim,
        "project": "duck-souls",
        "target_metric": "funProxy",
        "keep_criterion": getattr(a, "keep", "") or "funProxy up past noise margin + fun_test all-green + holdout PASS",
        "source": "autotune",
        "gate": "holdout+fun_test",      # deposit gate requires a holdout PASS (see below)
        "holdout": getattr(a, "holdout", "n/a"),  # 'PASS' from autotune's fresh-seed confirmation
    }


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("deposit")
    for f in ("key", "claim"):
        d.add_argument(f"--{f}", required=True)
    d.add_argument("--grade", required=True)          # moot council letter
    d.add_argument("--refuters", type=int, default=3)  # adversarial refuters survived (of 3)
    d.add_argument("--holdout", default="PASS")
    d.add_argument("--keep", default="")
    d.add_argument("--dry", action="store_true")  # build+print candidate, no db write
    p = sub.add_parser("park")
    for f in ("key", "claim", "reason"):
        p.add_argument(f"--{f}", required=True)
    a = ap.parse_args()

    if a.cmd == "deposit":
        # PASS bar (matches /autoresearch-grade): >=2/3 refuters survived AND grade in top band
        if a.refuters < 2 or a.grade not in ("A+", "A", "A-", "B+"):
            print(f"REFUSED: grade {a.grade} / {a.refuters}/3 refuters below the PASS bar — use park", file=sys.stderr)
            sys.exit(2)
        verdict = {"grade": a.grade, "refuters_failed": a.refuters, "holdout": a.holdout}
        if a.dry:
            import json
            print(json.dumps({"candidate": candidate(a), "verdict": verdict}, indent=2)); return
        try:
            hyp_id = ar.deposit(HYP_DB, candidate(a), verdict, LEDGER)
        except getattr(ar, "HoldoutFailed", Exception) as e:
            print(f"HOLDOUT FAILED (overfit gate) — must park: {e}", file=sys.stderr); sys.exit(3)
        print(hyp_id)  # e.g. HYP-AR-mutroll-0813
    else:
        ar.park(PARKED, candidate(a), a.reason)
        print(f"parked: {a.key}")


if __name__ == "__main__":
    main()
