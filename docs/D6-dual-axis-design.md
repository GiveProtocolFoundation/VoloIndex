# D6 Dual-Axis Translation Design — Scope + Relational Boundary-Awareness

**Author:** CEO (framework author, Loftus relational-boundary layer) · **Status:** v1.0 — design authority for D6 audience-tier translation
**Issue lineage:** GIV-635 (spike) → GIV-632 (D6 translation) → GIV-628 (T2-H) → GIV-620 → GIV-542
**Resolves:** `docs/T2-H-D4-D6-translation-plan.md` §6 Q3 — CEO chose option **(a)**: author the design, hand to CPO for probe authoring.

---

## 1. Why D6 is a special case

Every dimension runs the framework-wide **scope boundary-awareness rule (v1.0)** — one cross-cutting axis on top of the substantive score. D6 (Ethics, Equity & Advocacy) is the only dimension where a **second boundary axis** is itself substantive: relational boundary-awareness (Loftus taxonomy). Ethical practice with volunteers *is* largely the management of relational boundaries, so the axis cannot be folded into the substantive anchors without losing diagnostic signal — a practitioner can be substantively fluent in equity policy while relationally boundary-blind, and vice versa. The two failure modes need separate visibility.

Hence: **every D6 probe is scored on two axes simultaneously**, and both surface in output.

## 2. The two axes

### Axis S — Scope boundary-awareness (framework-wide v1.0, unchanged)

Exactly as locked framework-wide and restated in D5.md §3:

- Substantive escalation protects the floor (correct recognition + handoff earns credit at the developmental level of the recognition).
- Uncorrected miscalibration caps the sub-domain at Proficient.
- Probes/sub-domains may thin or drop at lower bands.

Nothing new. D6 applies it per probe with a scope note, same as D1–D5.

### Axis R — Relational boundary-awareness (Loftus taxonomy layer)

The taxonomy layer as applied in D6 groups relational-boundary competence into six categories. (This is the structural summary for design purposes; the authoritative per-probe bindings and sources are in the D6 v0.1 draft, which is fully sourced — README notes D6 is the deepest-sourced dimension with no literature gap.)

| # | Category | Failure mode it detects |
|---|---|---|
| R1 | Role–relationship confusion (dual relationships) | Volunteer relationships bleeding into friendship, patronage, or commerce without recognition |
| R2 | Emotional involvement calibration | Over-involvement (rescuing, favouritism) and under-involvement (instrumental detachment) |
| R3 | Gifts, favours & reciprocity | Unexamined reciprocity creating obligation, preference, or perceived corruption |
| R4 | Self-disclosure calibration | Disclosure serving the discloser rather than the relationship's purpose |
| R5 | Confidentiality & information boundaries | Information crossing lines between volunteers, staff, beneficiaries, and public |
| R6 | Power & dependency with beneficiaries | Failing to see the asymmetry volunteers carry into beneficiary relationships |

**Key structural property:** Axis R is *graded*, not binary. Boundary competence is not "never crosses a line" — it is recognising the boundary, naming the tension, and handling it deliberately. Rigid boundary-policing that damages the relationship is itself a Developing-level pattern (competent practitioners hold boundaries *warmly*).

## 3. Design decisions (the gate content)

### D-1 · Per-probe presentation

Each D6 probe carries the D5 r1 shape **plus one added block**:

- Prompt · Sub-domain · Anchors · Developmental-level anchors (F/D/P/E) with S1/S2/S3 markers · Red-flag clauses · **Scope-boundary-awareness note** — all exactly as D5 r1.
- **NEW: Relational-boundary-awareness note** — names which R-category(ies) the probe exercises, and gives per-band F/D/P/E anchor *deltas* for the relational reading of the same answer (see D-3). A probe may be R-silent only if it genuinely exercises no relational content; target ≥12 of 16 probes R-active, and every R-category covered at least twice across the dimension.

The substantive anchors and the relational anchors read **the same transcript evidence** — the candidate is never told there are two axes. Dual scoring is an assessor/engine-side lens, not a candidate-side prompt structure.

### D-2 · Scoring realization — no engine change

Precedent: D5 reuses the D3 autonomy axis purely via **sub-domain tagging** ("the engine picks up autonomy-axis probes by sub-domain tag" — D5.md §4). D6 does the same:

- Relational-axis evidence is recorded as signals tagged with relational sub-domain ids (`6.R1`–`6.R6` as needed), parallel to the substantive sub-domain ids (`6.1`–`6.4`).
- The engine scores them with the standard §5 machinery — same position formula, band floors (3.1/5.6/7.6), §5.5 red-flag caps, §5.5 3-signal IE minimum (per BUG-001 ruling, N signals count toward the minimum).
- **Axis scores are aggregations of sub-domain scores**: Axis S/substantive = the `6.1`–`6.4` sub-domains; Axis R = the `6.R*` sub-domains. This is a content/reporting convention, not engine code. **RUBRIC_VERSION stays 1.2** — no gating-rule change, so §9 does not force a bump.

### D-3 · Per-band anchor progression for Axis R

The relational axis levels by **whose boundaries the practitioner is responsible for**, mirroring the band ladder:

| Band | Relational-axis remit |
|---|---|
| Team Lead | Own boundary practice in direct relationships; spotting a boundary drift in one volunteer |
| Coordinator | Pattern management across a pool; coaching volunteers' boundary practice; first-line handling of gifts/dual-relationship instances |
| Program Manager | Procedure & policy design: gift policy, dual-relationship disclosure routes, confidentiality protocols; making escalation safe |
| Director | Boundary *culture* and governance: safeguarding accountability, advocacy ethics (org voice vs. beneficiary voice), conflicts-of-interest regime |

Same thinning rule as scope: policy-level R-probes do not appear at Team Lead; hands-on single-relationship R-probes do not appear at Director.

### D-4 · Strength markers

Unchanged semantics on both axes: S1 = concrete instance with observable practice change; S2 = pattern across cases with reasoning; S3 = system/policy design that removes the failure mode. On Axis R, S3 evidence is specifically *boundary infrastructure* (a disclosure norm, a gift log, a supervision practice) rather than personal virtue claims.

### D-5 · Red-flag mapping — every flag is axis-tagged

Every D6 red-flag clause carries an axis tag in its id: `RF-{probe}-{n}-S` (scope/substantive) or `RF-{probe}-{n}-R` (relational). Caps apply **per axis**:

- An uncorrected relational red flag caps the *relevant `6.R*` sub-domain* (and therefore Axis R) per §5.5 — it does **not** directly cap the substantive axis.
- Likewise substantive/scope flags do not directly cap Axis R.
- **Dimension-level D6 score = min(Axis S aggregate, Axis R aggregate).** Lowest-wins, consistent with the rubric's monotonic-cap philosophy: relational boundary-blindness cannot be bought back with substantive brilliance, and vice versa.

Canonical relational red-flag families (CPO instantiates per probe from the D6 v0.1 sourced draft):

1. **Boundary-blindness** — narrates a dual relationship / gift / disclosure with no recognition that a boundary exists. Uncorrected clear instance → §5.5 cap on the R-sub-domain.
2. **Boundary-as-wall** — treats every relational tension as a rule-enforcement problem; policing framed as the *only* tool. Uncorrected pattern → caps R-sub-domain at Proficient (misconception cap).
3. **Exceptionalism** — "that rule is for others; my relationship with this volunteer/beneficiary is different." The most predictive flag in the taxonomy. Uncorrected → red-flag cap, and if clear+N, standard §5.4 midpoint drop applies.

### D-6 · Escalation symmetry (the interplay rule)

The scope rule's escalation credit extends to Axis R: a practitioner who recognises a relational-boundary situation as beyond what they should handle alone (e.g., a beneficiary dependency forming, a safeguarding-adjacent disclosure) and routes it correctly (supervisor, safeguarding lead, documented disclosure) earns Axis-R credit at the developmental level of that recognition + routing. Relational escalation is Proficient-level relational practice, not avoidance. The inverse also holds: confidently "handling" a reportable relational situation solo, without noticing it is reportable, is scope miscalibration **and** a relational flag — one answer can legitimately hit both axes.

### D-7 · Output surfacing

- **Content JSON (`content/probes/D6.json`):** identical schema to D5.json plus, per probe: `relationalCategories: ["R1", ...]` (possibly empty), `axis` on each red-flag entry (`"scope" | "relational"`), and relational anchor-delta text fields mirroring the substantive anchor fields. Sub-domain ids distinguish `6.x` vs `6.Rx`.
- **Score report:** D6 renders one dimension row with two sub-scores: `Ethics, Equity & Advocacy — substantive: X.X · relational boundaries: Y.Y · dimension: min`. Both sub-scores appear on the certificate detail view; the certificate headline uses the dimension (min) score. No other dimension changes shape.
- **README build-status:** on D6 r1 sign-off the row flips to `✅ 4 tiers · 16/16 probes · dual-axis`.

## 4. Probe template delta (vs D5 r1)

```
#### Probe {band}-{n} — {title} ({6.x substantive sub-domain})
**Prompt.** ...
- **Anchors:** ...                                   ← unchanged
- **Foundational / Developing / Proficient / Expert** ← unchanged (substantive reading)
- **Relational axis ({R-categories}).** Per-level deltas: what the F/D/P/E
  bands look like when the SAME answer is read for boundary practice.
  Omitted only if the probe is R-silent.
- **Red flags / misconceptions.** Each tagged -S or -R.
- **Scope-boundary-awareness.** ...                  ← unchanged
```

## 5. Acceptance criteria for D6 r1 (adds to the locked per-dimension definition of done)

1. 16 probes × 4 bands, D5-r1 shape, all D6 v0.1 sources bound — unchanged baseline.
2. ≥12 probes R-active; every R1–R6 category exercised ≥2× across the dimension; coverage table included in D6.md.
3. Every red flag axis-tagged; ≥1 instance of each canonical relational family (D-5) present.
4. At least one probe per band demonstrating the escalation-symmetry rule (D-6).
5. `D6.json` validates: 4/band, sub-domain ids partition into `6.x` / `6.Rx`, every `relationalCategories` entry ∈ R1–R6.
6. CEO sign-off as domain authority (Loftus layer) — same request_confirmation pattern as GIV-630/D5.

## 6. What this doc does NOT decide

- Probe content, prompts, and source bindings — CPO authors from the D6 v0.1 sourced draft, per this design.
- Engine changes — none permitted or needed (D-2). If probe authoring surfaces a case the tagging convention cannot express, that is a stop-and-escalate to CEO/CTO, not a workaround.
- Certificate marketing copy for dual-axis scoring — CMO/board, post-r1.
