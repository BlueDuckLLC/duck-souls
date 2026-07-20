
## Epoch 2026-07-20 — baseline 0.300
- insetScale 1→1.12: proxy 0.300→0.300 [reject(no gain)]
- mutRoll 0.65→0.73: proxy 0.300→0.400 [ACCEPT]
- dangerBase 2→2.5: proxy 0.300→0.300 [reject(no gain)]
epoch: 0 accepted, final funProxy 0.300

## AI-scientist epoch 2026-07-20 (Stage D — first full loop with real autoresearch)
- RECALL: prior ledger showed mutRoll 0.65→0.73 nudging funProxy 0.30→0.40
- PROPOSE: raise room.mutRoll 0.65→0.73
- VERIFY (autotune.mjs --eval): funProxy 0.30, holdout PASS, fun_test green — BUT metrics
  degenerate: avgFloor=1, variety=0, deaths=0 (the bot stalls on floor 1)
- GRADE (real moot council, 10 SMEs incl Meier/Blow/Kohavi/Togelius): **D+** — Goodhart;
  variety measured on unreached rooms; adversary (Rogers): "prettiest lie a CSV has told me"
- OUTCOME: **PARKED** to ~/org-engine/data-science/autoresearch_graded_parked.jsonl
- LOAD-BEARING FINDING (from the council): the tuning objective is invalid until the bot
  actually PLAYS (reaches past floor 1, takes damage, engages mutators). Fix the bot FIRST,
  then re-measure with a controlled A/B. → this is the next work.
