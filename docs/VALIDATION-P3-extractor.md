# Volo Index — §9-style Extractor Validation (Assessment Engine P3 / GIV-593)

**Validator:** Head of Data, Give Protocol Foundation
**Date:** 2026-07-12
**Scope:** GIV-593 (AE-P3) — independent validation of the AI assessment engine's
extraction pipeline and its human-in-the-loop safeguards before the CTO flips the
`ASSESSMENT_ENGINE_ENABLED` go-live gate. Parent epic [GIV-583].
**Verdict:** **PASS.** The deterministic guardrails that stand between LLM proposals
and a published score are sound, the D4/D5 governance machinery is arithmetically
correct, and the extractor introduces no scoring drift. The gate flip is CTO-owned;
handing back to CTO with empirical sign-off.

---

## Method

Independent re-derivation, **not** a re-run of the engineer/QA suites. A hand-authored
golden transcript (`hod-golden-001`, one Q&A per dimension, verbatim spans) and
hand-labelled golden signals were built fresh in the harness; every expected value is
derived here, not copied from `test/*.test.js`. Harness:
`scripts/validate-extractor-p3.mjs` — **47/47 assertions pass**.

Confirmatory suites (all green on `main`, commit `dd41f7f`):
- Engineer `npm test` + `node --test test/*.test.js` — 223/223
- QA `node --test tests/*.test.js` — 86/86
- Combined — **309/309**

### On the ≥95% agreement number (D5)

The live LLM-vs-human extraction-agreement rate — the D5 auto-publish threshold — can
only accrue from real assessments. It is measured **at runtime** by QA over the first
50 public results, which `PublicationQueue` holds in `pending_review`. This validation
does not (and cannot in CI, no live API) produce that number. What it proves is that
(a) the deterministic guardrails are sound and (b) the counter/agreement machinery that
will collect the runtime number is correct — so that number can be trusted when it
lands. The gate stays **off** until it is observed.

## What was independently re-derived and confirmed

| Area | Property checked | Result |
|---|---|---|
| Extractor fidelity (P1 gate ≥0.90) | Faithful LLM proposals → deterministic layer is lossless; signal-type agreement vs golden labels = **1.0** | ✓ |
| Anti-hallucination gate | Fabricated / out-of-transcript spans (incl. inflated Expert claims) dropped; survivors reproduce the golden set exactly; **no fabricated Expert signal survives** | ✓ |
| No scoring drift (§integrity) | extract-then-score == score-directly on identical signals (overall score + tier + per-dim identical) | ✓ |
| Consent (D4) | InMemory + File stores reject `consentGiven` absent / `false` / truthy-string; nothing persisted on rejection; consented record round-trips | ✓ |
| Consent (D4) — path safety | `FileTranscriptStore` `../../etc/evil` sanitised in-dir; nothing written outside the store dir | ✓ |
| Publication queue (D5) | 49 reviews @100% → **no** flip (count<50); 50 @0.94 → no flip; 50 @0.96 → **flip**; post-flip entries auto-publish | ✓ |
| Publication queue (D5) — AND not OR | high volume (200) at running 0.90 never flips — both conditions required | ✓ |
| Publication queue (D5) — durability | `toJSON`/`fromJSON` preserves reviewed/agreement counters and latched flip state | ✓ |
| Red-team | self-assertion / rubric-code mention / embedded-JSON candidate answers → 0 signals; a "fooled" LLM's fabricated Expert span still dropped by the gate | ✓ |
| Go-live gate | `ASSESSMENT_ENGINE_ENABLED === false` (default-off) | ✓ |

## Findings

1. **Auto-publish latches incrementally (correct, documented).** The D5 flip is
   evaluated after *each* release against the *running* review count and *running*
   agreement rate; once ≥50 reviews AND rate ≥0.95 both hold it latches on and never
   un-latches. Consequence for validators/operators: a stream whose *final* aggregate
   rate is <95% can still auto-enable if an early prefix (≥50 reviews) cleared 95% —
   verdict ordering matters. This is the intended "once QA has demonstrated sustained
   agreement, stop holding" behavior, not a defect. Flagged so QA sequences spot-checks
   representatively rather than front-loading easy cases. (Harness case 4d asserts the
   converse: a rate held below 95% throughout never flips.)

2. **The anti-hallucination gate is the load-bearing defence.** Injection resistance
   does not depend on the LLM resisting the prompt — it depends on the verbatim
   `spanText ∈ turn.content` check plus deterministic validation. Even a fully "fooled"
   extractor cannot publish evidence that isn't literally in the transcript, and cannot
   inflate tier beyond transcript-grounded spans. This is the correct trust boundary.

## Open items (non-blocking)

- **RUNTIME-1 (owned by QA, D5):** the first-50 `pending_review` spot-check must be
  sequenced representatively (see Finding 1) so the ≥95% latch reflects real sustained
  agreement, not an easy prefix. Operational note, not a code change.
- No engine or pipeline defects found.

## Disposition

§9-style extractor validation **PASSES**. Empirical sign-off granted for the go-live
gate decision. `ASSESSMENT_ENGINE_ENABLED` is CTO-owned infrastructure — handing back
to CTO ([GIV-583]) to make the flip. Re-run `scripts/validate-extractor-p3.mjs` plus
the full suites on any change to the extractor, consent store, or publication queue
before re-enabling.
