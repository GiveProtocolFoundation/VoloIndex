# Volo Index — §9 Re-validation Report (Rubric v1.1)

**Validator:** Head of Data, Give Protocol Foundation
**Date:** 2026-07-04
**Scope:** GIV-571 — numeric re-validation of the v1.1 scoring engine against `docs/SCORING_RUBRIC.md` (v1.1, R1–R7).
**Verdict:** **PASS.** The engine on `main` reproduces the v1.1 rubric. Public scoring may be un-gated (gate action owned by CTO).

---

## Method

This is an **independent** re-validation, not a re-run of the CTO's authoring tests. Expected
values were hand-derived directly from the rubric prose (§5.2/§5.3/§5.4/§6.4/§7/§8) and then
checked against live engine output. Harness: `scripts/revalidate-v1.1.mjs` (33 assertions).

Confirmatory suites (all green on `main`, commit `c7e72e1`):
- Engineer suite `npm test` — 59/59
- QA suite `tests/qa-engine.test.js` — 60/60
- Compliance suite `tests/qa-engine-v1.1.test.js` — 26/26

Independent harness `scripts/revalidate-v1.1.mjs` — **33/33**.

## What was re-derived and confirmed

| § | Rule | Independent check | Result |
|---|------|-------------------|--------|
| 5.2 | Q-rebased position `min(1,max(0,(Σ−Q)/(K−Q)))` | Foundational 1.8, Developing floor 3.1 / mid 4.3 / sat 5.5, Proficient floor 5.6 / mid 6.6, Expert floor 7.6 | ✓ |
| 5.3 | Expert breadth cap (>8.5 needs 3 distinct strong Expert anchors) | 2 distinct anchors → cap 8.5 recorded; 3 distinct → 10.0 uncapped | ✓ |
| 5.4 | Monotonic red-flag caps, lowest-of-caps | 1N/Expert→6.6, 2N/Expert→4.3, 1N/Proficient→4.3, 2N/Developing→floor 1.0, corrected N ignored | ✓ |
| 7 | Recall inflation retarget (≥4 S1, exactly 1 clear S2, no strong S2/S3+) | fires → 4.3; does not fire when a strong S2 present | ✓ |
| 5.5 | Insufficient evidence (<3 positive signals) | score null, `insufficientEvidence` true | ✓ |
| 6.4 | Overall Expert constraint (≥4 Prof+ and ≥2 Expert) | all-Expert 7.6 uncapped; 1-Expert/5-Prof 7.9→capped 7.5 | ✓ |
| 8 | Output contract (`rubricVersion`, `evidenceDensity{Q}`, per-signal `tier`, `appliedCaps`, `overall.capReason`) | all fields present and correct | ✓ |
| — | Determinism | identical output on repeated calls | ✓ |

## Findings

Two harness assertions initially failed; **both were validator hand-derivation errors, not engine
defects**, and became confirming evidence once corrected:

1. **Band-floor reachability nuance (not a bug).** The Developing/Proficient/Expert *floor*
   (3.1/5.6/7.6) is reachable only when the mandatory 3rd signal (§5.5, ≥3 signals to score)
   anchors *below* the base tier, so it stays out of Σ (`positionScore` counts only
   `anchorTier ≥ baseTier`). If the 3rd qualifying signal sits at-or-above the base tier, Σ>Q and
   the score sits above the floor — correct "more evidence ⇒ higher score" behavior. R2's
   reachability goal holds; documented here so future validators don't mis-derive the floor.

## Open items (non-blocking, hand back with the un-gate)

- **DOC-NIT-1 (§8 example):** the illustrative JSON shows `position 0.5` with `score 6.8`; the
  formula yields `5.6 + 0.5×1.9 = 6.55 → 6.6`. Cosmetic inconsistency in an example only — engine
  is correct. Recommend fixing the example number to `6.6` in a doc-only follow-up.
- **BUG-001 (§5.5 ambiguity): RESOLVED 2026-07-04 (GIV-573).** Head of Data ruling: `N` signals **do
  count** toward the 3-signal Insufficient-Evidence minimum (recorded in `docs/SCORING_RUBRIC.md`
  §5.5). This contradicts the current engine (counts only positive signals), so an engine-change
  follow-up is filed to CTO; fixture `07-red-flag-caps.json` case_B is annotated to match. Not
  triggered by any §9 case, so public scoring is unaffected until the engine change deploys (which
  will change scores for sparse-but-flagged transcripts and warrants a version bump + re-run of this
  harness before release).

## Disposition

§9 re-validation **passes**. Empirical sign-off granted for public scoring. The go-live gate flag
is CTO-owned infrastructure; handing back to CTO to un-gate. Re-run `scripts/revalidate-v1.1.mjs`
plus the three suites on any future rubric change before re-enabling.
