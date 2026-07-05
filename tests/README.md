# Volo Index — QA Test Suite

Tests for the scoring engine per rubric v1.1 (`docs/SCORING_RUBRIC.md`).

## Running

```bash
node tests/run-qa.js --engine ./src/scoring-engine.js
node tests/run-qa.js --engine ./src/scoring-engine.js --verbose
node tests/run-qa.js --engine ./src/scoring-engine.js --fixture 06-expert
```

The engine module must export `scoreAssessment(input)` or a default function with that signature.

## Fixture Index

| File | What it covers |
|------|----------------|
| `01-foundational-tier.json` | Insufficient Evidence when <3 signals |
| `02-foundational-scored.json` | S1-only Foundational scoring formula |
| `03-boundary-3.0-vs-3.1.json` | §2 tier boundary: Foundational 3.0 vs Developing 3.1 |
| `04-boundary-5.5-vs-5.6.json` | §2 tier boundary: Developing 5.5 vs Proficient 5.6 |
| `05-boundary-7.5-vs-7.6.json` | §2 tier boundary: Proficient 7.5 vs Expert 7.6 |
| `06-expert-breadth-gate-8.5.json` | §5.3 Expert breadth gate: scores >8.5 need 3 distinct strong anchors |
| `07-red-flag-caps.json` | §5.4 N signal caps: single N, double N, N on Foundational, self-correction |
| `08-insufficient-evidence.json` | §5.5 + §6.2–6.3: IE per-dimension and partial/incomplete overall |
| `09-overall-tier-cap.json` | §6.4: overall tier cap when <4 Proficient+ or <2 Expert dims |
| `10-integrity-checks.json` | §7: all four integrity rules (v1.1 recall inflation retarget, generic answer, contradiction, uniform max) |
| `11-output-contract.json` | §8: complete v1.1 output contract — evidenceDensity, appliedCaps, signal tier, capReason, rounding, integrityFlags names |
| `12-band-reachability.json` | §5.2 (v1.1 R2): regression guard — bands 3.1–4.2, 5.6–6.3, 7.6–8.3 reachable with the Q offset |

## Ambiguity Log

The following rubric points are ambiguous and should be clarified with the rubric author before the engine is considered conformant:

1. **Position formula — which signals count?** §5.2 says "Σ signal_strength at base tier and above." It is unclear whether signal *type* tier (S1=Foundational, S2=Developing, S3/S4=Proficient, S5/S6=Expert) or the *content tier* of the answer determines inclusion. Fixture `11-output-contract.json` (D4) documents both interpretations.

2. **Expert breadth gate — "distinct anchor behaviors"** §5.3 says strong signals in "at least three distinct anchor behaviors of the Expert row." The rubric lists 4–5 named behaviors per Expert tier (e.g., D1 Expert: ROI/business case, theory of change alignment, capacity planning, advocacy). It is unclear whether the engine must enumerate and label these behaviors explicitly, or whether the scorer infers them from the signal `anchor` field. Fixture 06 uses the `anchor` field as the discriminator.

3. **Developing midpoint** §5.4 says "midpoint of the tier below." Developing range is 3.1–5.5, midpoint = (3.1+5.5)/2 = 4.3. This appears to be what the rubric intends (4.3). Foundational midpoint = (1.0+3.0)/2 = 2.0. Fixtures 07A and 07B assume these values. *(v1.1 R1 update: caps are now monotonic — n uncorrected red flags cap at the midpoint of the tier n steps below base, floor 1.0, with the ≥2-flag Developing cap still applying; the lowest triggered cap wins. Fixture 07D reflects this: 2 N on Expert base → 4.3, not 5.5.)*
