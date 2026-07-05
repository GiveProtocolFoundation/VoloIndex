# Volo Index — Scoring Rubric v1.1

**Status:** v1.1 — Head of Data §9 re-validation **PASSED** 2026-07-04 (see `docs/VALIDATION-v1.1.md`); public scoring cleared to un-gate (gate action owned by CTO)
**Owner:** Give Protocol Foundation — Volo Index
**Applies to:** All six assessment dimensions, all four developmental tiers
**Last updated:** 2026-07-04

**Changes since v1.0:** applied R1–R7 from GIV-565 methodology validation — monotonic red-flag caps (§5.4); rebased in-tier position on qualifying threshold `Q` so full tier ranges are reachable (§5.2); retargeted "Recall inflation" integrity check onto the one-token-S2 gaming vector (§7); expanded output contract with per-signal `tier`, per-dimension `evidenceDensity`/`appliedCaps`, `redFlags[].corrected`, and `overall.capReason` (§8); renamed §3 taxonomy column to "Gates Entry To" with corrected values (R5); fixed §6.4 "cannot be Expert" wording and specified the §5.3 expert-breadth cap action (R6); added PII/governance rules excluding verbatim `excerpt` from public leaderboard/exports and defining retention + access + assessment-start notice (R7).

---

## 1. Purpose

This rubric is the canonical scoring specification for the Volo Index assessment. It defines:

- how conversational assessment responses map to numeric scores (1.0–10.0, one decimal place),
- behavioral anchors for each of the 6 dimensions at each of the 4 tiers,
- the signal taxonomy used to classify evidence during the assessment,
- aggregation rules that produce the per-dimension scores and the overall Volo Index,
- minimum-evidence and consistency rules that protect score integrity.

The scoring engine, assessment prompts, and results UI must all conform to this document. Changes require a version bump and re-validation.

---

## 2. Scale and Tiers

| Tier | Score Range | Summary |
|------|-------------|---------|
| **Foundational** | 1.0 – 3.0 | Basic awareness; instinct-driven; conflates volunteer and employee management |
| **Developing** | 3.1 – 5.5 | Understands principles; inconsistent application; reactive → intentional transition |
| **Proficient** | 5.6 – 7.5 | Consistent, intentional practice; articulates reasoning; adapts to context |
| **Expert** | 7.6 – 10.0 | Evaluates systems; designs programs; advocates strategically; mentors others |

Tier boundaries are inclusive of the upper bound (a 3.0 is Foundational; a 3.1 is Developing). These boundaries match the shipped UI (`tierFor(score)` in the app).

---

## 3. Signal Taxonomy

Every scoring-relevant statement a candidate makes is classified as one or more **signals**. Signals are the atomic unit of evidence.

| Signal Type | Code | What It Shows | Gates Entry To |
|-------------|------|---------------|----------------|
| **Recall** | `S1` | Knows terms, concepts, or best practices | — |
| **Applied Practice** | `S2` | Concrete first-person example with context and outcome | Developing |
| **Reasoning** | `S3` | Explains *why*, trade-offs, when it fails | Proficient (with S4/2nd S3) |
| **Adaptation** | `S4` | Adjusts approach to context | Proficient (with S3) |
| **Systems Design** | `S5` | Builds/evaluates programs, processes, policies | Expert (with S6) |
| **Advocacy & Mentorship** | `S6` | Advances the function; develops practitioners | Expert (with S5) |

*Lacking a signal ceilings the candidate at the tier immediately below the one it gates.*

**Signal strength** is rated per instance: `weak` (0.5), `clear` (1.0), `strong` (1.5). A strong signal includes specifics: real situation, action taken, observed result.

**Negative signals** (`N`) are recorded when a response demonstrates a misconception listed in a dimension's "red flags." Each negative signal caps or reduces the dimension score (see §6.4).

---

## 4. Dimension Anchors

Each dimension below defines: what is measured, tier anchors (the observable behaviors that place a candidate in a tier), and red flags (misconceptions that cap the score).

### Dimension 1 — Strategic Engagement Design

*Connects volunteer engagement to organizational mission and strategy.*

| Tier | Anchor Behaviors |
|------|------------------|
| **Foundational (1.0–3.0)** | Sees volunteers as free labor to fill gaps. Recruits when short-handed with no link to mission or plan. Cannot articulate why the org engages volunteers beyond cost savings. |
| **Developing (3.1–5.5)** | Recognizes volunteers should connect to mission. Has written role descriptions with purpose statements. Sets basic program goals but they are activity counts (hours, headcount), not outcomes. Assesses readiness informally. |
| **Proficient (5.6–7.5)** | Assesses organizational readiness before expanding roles. Identifies where volunteers create distinct value vs. where paid staff are required. Sets outcome-linked program goals and reviews them on a cycle. Can articulate the strategic case for the volunteer function to leadership. |
| **Expert (7.6–10.0)** | Designs engagement strategy as part of org strategy: builds business cases with ROI/VIVA-style valuation, aligns volunteer roles to theory of change, plans capacity and infrastructure ahead of growth, and influences board/executive investment decisions. Mentors peers on strategic design. |

**Red flags (N):** "Volunteers are free"; treating volunteer engagement purely as HR overflow; goals that are only hour counts presented as impact.

### Dimension 2 — Recruitment, Matching & Onboarding

*Attracts the right volunteers, matches motivation and skill to role, integrates them for long-term success.*

| Tier | Anchor Behaviors |
|------|------------------|
| **Foundational (1.0–3.0)** | Posts generic "volunteers needed" appeals. Accepts anyone for any role. Onboarding is paperwork plus a point in the right direction. No screening beyond availability. |
| **Developing (3.1–5.5)** | Writes role-specific recruitment messages. Conducts basic interviews or placement conversations. Has an orientation checklist. Aware that motivation matters but doesn't systematically assess it. |
| **Proficient (5.6–7.5)** | Recruits against defined role profiles through channels chosen for the target audience. Uses motivation-based matching (functional motives: values, understanding, social, career, esteem, protective). Onboarding is staged: orientation → role training → early check-in. Tracks conversion from inquiry to active volunteer. |
| **Expert (7.6–10.0)** | Designs the full attraction-to-integration pipeline with measured drop-off points. Builds inclusive recruitment that reaches beyond the usual demographics. Trains staff on matching practice. Evaluates and redesigns onboarding based on 90-day retention data. |

**Red flags (N):** "Any warm body"; screening only for availability in high-responsibility roles; onboarding conflated with a single orientation event.

### Dimension 3 — Training, Development & Role Support

*Prepares volunteers and supports growth without the leverage of a paycheck.*

| Tier | Anchor Behaviors |
|------|------------------|
| **Foundational (1.0–3.0)** | Training is "shadow someone for a shift." No ongoing support structure. Assumes volunteers will ask if they need help. |
| **Developing (3.1–5.5)** | Provides structured initial training for most roles. Does occasional check-ins. Recognizes experienced volunteers get bored but has no development pathway. |
| **Proficient (5.6–7.5)** | Designs role-appropriate training (depth scaled to responsibility and risk). Provides ongoing coaching and identifies support needs proactively. Creates growth options: skill expansion, leadership roles, mentoring assignments. Adapts support style to the individual. |
| **Expert (7.6–10.0)** | Builds tiered development pathways across the program (frontline → lead → trainer). Uses adult-learning principles deliberately. Develops volunteers as trainers and mentors of other volunteers. Evaluates training effectiveness against role performance, not attendance. |

**Red flags (N):** Training treated as one-time compliance; no distinction between low-risk and high-risk role preparation; "they're just volunteers, they don't need development."

### Dimension 4 — Performance, Impact & Accountability

*Manages performance, measures impact, and maintains accountability within a volunteer relationship.*

| Tier | Anchor Behaviors |
|------|------------------|
| **Foundational (1.0–3.0)** | Avoids all performance conversations ("you can't fire a volunteer"). No expectations set beyond showing up. Reports activity (hours) as impact, if anything. |
| **Developing (3.1–5.5)** | Sets written expectations for key roles. Gives informal feedback but avoids hard conversations. Collects some output data (people served, tasks done) without tying it to outcomes. |
| **Proficient (5.6–7.5)** | Sets clear expectations at placement and revisits them. Gives timely, specific feedback including on underperformance; can reassign or release a volunteer respectfully and knows when to. Measures program outputs and connects them to outcomes. Communicates program value to stakeholders with evidence. |
| **Expert (7.6–10.0)** | Runs a full accountability system: expectations, feedback loops, escalation, and dignified exit paths, designed for the volunteer context. Builds impact measurement frameworks (outputs → outcomes → attributable impact) and uses valuation methods appropriately (and knows their limits). Coaches staff on volunteer performance management. |

**Red flags (N):** "You can't hold volunteers accountable"; equating hours × wage-rate with program impact without caveat; keeping a harmful volunteer in place to avoid conflict.

### Dimension 5 — Recognition, Retention & Culture

*Sustains commitment through meaningful recognition, retention practice, and healthy culture.*

| Tier | Anchor Behaviors |
|------|------------------|
| **Foundational (1.0–3.0)** | Recognition = annual certificate or banquet for everyone, identical. Attributes turnover to volunteer flakiness. Unaware of staff–volunteer friction. |
| **Developing (3.1–5.5)** | Thanks volunteers regularly. Notices that different people like different recognition but applies this ad hoc. Tracks retention loosely; exit reasons unknown. |
| **Proficient (5.6–7.5)** | Matches recognition to individual motivation (public vs. private, growth vs. gratitude). Monitors engagement signals and intervenes on flight risk. Runs exit conversations and uses the data. Actively builds belonging between paid staff and volunteers. |
| **Expert (7.6–10.0)** | Designs recognition and retention systems grounded in motivation research, measured by cohort retention curves. Diagnoses cultural root causes of attrition. Builds org-wide culture where volunteers are integrated in decision-making, and equips staff to sustain it. |

**Red flags (N):** One-size-fits-all recognition defended as sufficient; retention treated as luck; dismissing staff–volunteer tension as unimportant.

### Dimension 6 — Ethics, Equity & Advocacy

*Navigates ethical complexity of unpaid labor, ensures equitable access, advocates for the function.*

| Tier | Anchor Behaviors |
|------|------------------|
| **Foundational (1.0–3.0)** | Unaware of power dynamics in unpaid work. Program design assumes volunteers have free time, transport, and disposable income. Shares volunteer/client information loosely. Accepts whatever resources are given. |
| **Developing (3.1–5.5)** | Recognizes some barriers to participation and some confidentiality obligations. Addresses issues when raised but doesn't audit proactively. Advocates for the program occasionally, reactively. |
| **Proficient (5.6–7.5)** | Applies ethical frameworks to boundary situations (volunteer–client boundaries, job displacement, unpaid-labor ethics). Designs for access: cost, schedule, language, ability. Handles volunteer and client data with defined privacy practice. Makes the case for program resources with leadership. |
| **Expert (7.6–10.0)** | Builds equity audits and inclusive design into program infrastructure. Sets policy on ethical questions (displacement, boundaries, data). Advocates at organizational and field level for the volunteer function and the people in it. Mentors others on ethical practice. |

**Red flags (N):** No awareness that volunteering has access barriers; cavalier handling of personal data; framing volunteers as replacements for cut staff positions without concern.

---

## 5. Scoring Procedure (Per Dimension)

Each dimension is scored independently from the signals collected in that dimension's assessment section.

### 5.1 Base tier placement

1. Collect all signals for the dimension.
2. Determine the highest tier for which the candidate shows **≥ 2 clear-or-stronger signals** matching that tier's anchors, **including the required signal types**:
   - Developing requires ≥1 `S2` (applied practice).
   - Proficient requires ≥1 `S3` (reasoning) **and** ≥1 `S4` (adaptation) or a second distinct `S3`.
   - Expert requires ≥1 `S5` (systems design) **and** ≥1 `S6` (advocacy/mentorship), both at `clear` strength or better.
3. That tier is the **base tier**. If no tier qualifies, base tier = Foundational.

### 5.2 Position within tier

Position within the tier's numeric range is set by evidence density:

```
position = min(1.0, max(0, (Σ signal_strength at base tier and above − Q) / (K − Q)))
score    = tier_min + position × (tier_max − tier_min)
```

Where `Q` is the tier's qualifying signal-strength minimum: `Q = 0` for Foundational, `Q = 2.0` for Developing/Proficient/Expert (the ≥2 `clear`+ signals needed to enter the tier). `K` (saturation) = **4.0** Foundational/Developing, **5.0** Proficient, **6.0** Expert. This maps the qualifying minimum to `tier_min` and saturation to `tier_max`, so the full tier range is reachable. Round to one decimal.

### 5.3 Expert gating

Scores above 8.5 additionally require breadth: strong (1.5) signals in at least **three distinct anchor behaviors** of the Expert row. This keeps the top of the scale hard to reach by depth in a single niche.

If the computed dimension score exceeds 8.5 but the breadth condition is not met, cap the dimension score at 8.5 and record an `expert-breadth-cap` in `appliedCaps`.

### 5.4 Red flags

- Each uncorrected `N` signal at `clear`+ strength imposes a cap. With `n` uncorrected `N` signals, the cap is the **midpoint of the tier `n` steps below the base tier** (floor 1.0): one flag → midpoint of the tier immediately below base; two flags → midpoint two tiers below base; etc. Self-correction within the same assessment removes that signal from `n` (the record is retained).
- In addition, **two or more uncorrected `N` signals cap the dimension at Developing (≤ 5.5)**.
- The applied cap is the **lowest** of all caps triggered above. (This guarantees each additional red flag can only lower, never raise, the ceiling.)

### 5.5 Insufficient evidence

If a dimension yields **< 3 total signals**, the dimension is reported as **Insufficient Evidence** (no numeric score) and is excluded from the overall index (see §6). The UI must display this state distinctly, not as a low score.

---

## 6. Aggregation — The Volo Index

1. **Overall score** = arithmetic mean of the six dimension scores, rounded to one decimal. Dimensions are equally weighted in v1.1. (Tier-specific weighting is a candidate for v2 after pilot data.)
2. If 1 dimension is Insufficient Evidence, the overall is the mean of the remaining 5, flagged "partial."
3. If ≥ 2 dimensions are Insufficient Evidence, no overall index is issued; the assessment is reported incomplete and the credit is not consumed (product policy).
4. **Overall tier** is derived from the overall score using §2 boundaries, with one constraint: **the overall tier cannot be classified Expert (overall score is capped at 7.5) unless ≥ 4 dimensions are individually Proficient+ and ≥ 2 are Expert.**
5. Leaderboard rank uses the overall score; ties break by (a) number of Expert dimensions, (b) most recent assessment date (older first).

---

## 7. Consistency & Integrity Checks

The scoring engine must apply these checks before finalizing:

| Check | Rule | Action |
|-------|------|--------|
| **Recall inflation** | Dimension qualifies Developing+ but has ≥ 4 `S1`, exactly one `clear` `S2`, and no `S2`/`S3`+ signal at `strong` | Cap at Developing lower third (≤ 4.3) |
| **Cross-dimension contradiction** | Statements in one section contradict another (e.g., claims outcome measurement in D4, states "we only track hours" in D1) | Flag for both dimensions; use the weaker evidence |
| **Generic answer detection** | Signal instances with no first-person specificity | Downgrade `S2`+ claims to `S1` |
| **Uniform maximum** | All six dimensions score ≥ 9.0 | Hold for review; require §5.3 breadth evidence in all six |

---

## 8. Output Contract (for implementation)

The scoring engine must emit, per assessment:

```json
{
  "rubricVersion": "1.1",
  "dimensions": [
    {
      "id": "D1",
      "name": "Strategic Engagement Design",
      "score": 6.8,
      "tier": "Proficient",
      "baseTier": "Proficient",
      "evidenceDensity": { "sumStrength": 3.5, "K": 5.0, "Q": 2.0, "position": 0.5 },
      "signals": [
        { "type": "S3", "tier": "Proficient", "strength": 1.0, "excerpt": "...", "anchor": "outcome-linked goals" }
      ],
      "redFlags": [
        { "type": "N", "strength": 1.0, "excerpt": "...", "corrected": false }
      ],
      "appliedCaps": [
        { "rule": "§5.4", "capValue": 4.3, "reason": "1 uncorrected red flag" }
      ],
      "insufficientEvidence": false
    }
  ],
  "overall": { "score": 6.4, "tier": "Proficient", "partial": false, "capped": false, "capReason": null },
  "integrityFlags": []
}
```

- Dimension ids `D1`–`D6` map to §4 order.
- Each `signals[]` entry records its classified `tier` (the tier of the anchor it matched) so §5.2 is reproducible; `excerpt` is the candidate's own words (results page + auditability).
- **Every cap or adjustment applied — from §5.3, §5.4, §6, and §7 — must be listed**, per-dimension in `appliedCaps` (with rule ref, `capValue`, `reason`) and, for overall caps, in `overall.capReason`. `integrityFlags` lists §7 rule names plus the triggering excerpt id.
- `excerpt` values are candidate-provided free text and may contain personal data. They are stored only in the access-controlled evidence record for audit; they MUST NOT appear on the public leaderboard or in any shared/exported result. Retention and access for the evidence store follow the Volo Index data-governance policy, and candidates are notified at assessment start that verbatim excerpts are retained for auditability.

---

## 9. Versioning & Validation

- This is **v1.1**, applying R1–R7 from the GIV-565 methodology validation of v1.0. Head of Data §9 re-validation **passed on 2026-07-04** (independent numeric harness `scripts/revalidate-v1.1.mjs`, 33/33; report `docs/VALIDATION-v1.1.md`). Public scoring is cleared to un-gate; the gate flag is CTO-owned.
- Any change to anchors, boundaries, `K`/`Q` constants, or gating rules is a minor version bump; changes to the scale itself are major.
- Scored assessments store `rubricVersion`; results are never re-scored retroactively without explicit re-assessment consent.
- **Public-PII gate (R7 / §8):** verbatim `excerpt` values are excluded from the public leaderboard and from any shared/exported result. The evidence store retains excerpts under access control per the Volo Index data-governance policy, and candidates are notified at assessment start that verbatim excerpts are retained for scoring auditability.

---

*Volo Index — Give Protocol Foundation. The assessment content emerges from the research, not the other way around.*
