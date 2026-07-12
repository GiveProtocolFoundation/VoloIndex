# T2-H — D4–D6 Audience-Tier Translation Plan

**Owner:** CPO · **Parent:** GIV-628 (T2-H) → GIV-620 (Tranche 2) → GIV-542
**Date:** 2026-07-12 · **Status:** Plan for CEO ratification (content author is domain authority)

---

## 1. Purpose

Close the last content-side gap standing between Volo Index and a defensible **full six-dimension certificate of assessed competency**: audience-tier translations of Dimensions 4, 5, and 6. D1–D3 are done (16/16 probes × 4 tiers each, per README build-status table). D4–D6 have single-progression drafts but no per-tier translation, so a certificate covering them would not be honest today.

This plan sequences the work, defines "done," and surfaces the two decisions the board needs to unblock urgency.

---

## 2. What "audience-tier translation" means (pattern locked in D1–D3)

Each dimension is expressed as a single-progression research draft (Foundational → Expert). Translation adapts that progression to the four **Audience Scope Bands** — Team Lead, Coordinator, Program Manager, Director — so the probe a Team Lead sees differs in scope (not in rigour) from the probe a Director sees.

**Locked pattern (from D1/D2/D3):**

- **4 probes per band × 4 bands = 16 probes per dimension.**
- Same underlying developmental level scale (1.0–10.0) applies at every band; a Team Lead can score Expert without being pushed director-level questions.
- Scope-boundary-awareness rule (v1.0 framework-lock) runs across all bands: substantive escalation protects the floor; uncorrected miscalibration caps a sub-domain at Proficient.
- Probes and whole sub-domains may legitimately thin or drop at lower bands without breaking the dimension's spine. This is a feature, not a defect (Team Lead won't get org-strategy probes).
- Each translated probe carries: (a) the underlying literature anchor(s) from the source draft, (b) the developmental-level anchor tiers Foundational/Developing/Proficient/Expert with strength markers, (c) any red-flag / misconception clauses, (d) the audience-band framing (who is the practitioner, what is their remit, what evidence counts).
- Output form: markdown per dimension (paralleling the F4 content-model split targeted in the 2026-07-02 stock-take: `content/dimensions/D{n}.md`, `content/probes/D{n}.json`). Until F4 lands we author markdown and JSON side-by-side, ready to migrate.

**Definition of "done" per dimension:** 16 probes (4 per band) reviewed by CEO as domain authority, passing the scope-boundary-awareness rule, with red-flag / misconception clauses complete and every probe traceable to at least one peer-reviewed or authoritative practitioner source in the dimension's source list.

---

## 3. Sequencing (per README §Immediate Priorities)

Order chosen to maximise reuse of scoring machinery already built for D1–D3, and to defer the special-case dimension to last.

1. **D5 — Recognition, Retention & Culture (first).** Shares its second axis (autonomy / over-management) with D3, so the scoring machinery already validated for D3 recurs. Lowest translation risk.
2. **D4 — Performance, Impact & Accountability.** Requires corroborating the Groble Volunteer Authority Model on the cumulative source list before translation — a research-input gate, not just an authoring gate.
3. **D6 — Ethics, Equity & Advocacy (last).** Special case: runs **scope boundary-awareness AND relational boundary-awareness (Loftus taxonomy) simultaneously, scored on separate axes.** Translation needs a two-axis framing pass on top of the single-progression draft. Deferring to last lets us learn from D5 + D4 first, and avoids paying the special-case cost when we don't have to.

Post-pilot enhancements listed in README §Post-Pilot Enhancements (psychological-contract literature for D5, volunteer–staff conflict for D4, etc.) are **explicitly out of scope for T2-H**. They sharpen levelling after real assessment data, not before launch.

---

## 4. Per-dimension inputs and known gaps

| Dim | Draft status (README) | Translation input gate | Author risk |
|---|---|---|---|
| D5 | 🟢 v0.1 | None blocking — autonomy axis reused from D3 | Low |
| D4 | 🟢 v0.1 | **Groble Volunteer Authority Model corroboration on cumulative source list** before authoring | Medium — research-input gate |
| D6 | 🟢 v0.1 (deepest-sourced) | Dual-axis translation design (scope + relational boundary-awareness scored separately). All probes fully sourced per README | Medium — design gate, not source gate |

**No new literature is required to start D5.** D4 needs one research pass before authoring. D6 needs a small design-doc pass first ("how the two boundary axes present in a translated probe") but has no literature gap.

---

## 5. Interim launch option (board decision, not CPO decision)

The stock-take (`docs/STOCK-TAKE-2026-07-12-launch-readiness.md` §4) surfaces this decision explicitly: *"wait for D4–D6 translation (full certificate) vs. launch D1–D3 partial certificate sooner."*

CPO framing for the board:

- **D1–D3 partial certificate is defensible.** It covers Strategic Engagement Design, Recruitment/Matching/Onboarding, and Training/Development/Role Support — a coherent slice of the practitioner remit, all fully translated and scored. The language on the certificate must be honest: *"assessed competency across Dimensions 1–3 of the Volo Index framework (v1.0)"* — not silent-omission of D4–D6.
- **Cost of waiting for full six-dimension certificate:** D4–D6 translation is the T2-H scope below. It is parallel to the T2-A/B/C dependency spine (backend / web app / auth), so it does not delay backend/UI work — but it does gate any "full-scope" certificate marketing claim.
- **Recommendation:** launch on D1–D3 partial certificate. Ship the platform when the platform is ready; expand the certificate scope as D5, D4, D6 land (each dimension is a discrete additive release). This avoids holding the whole launch hostage to research pace.

**This is a CEO/board call.** T2-H proceeds either way; only the "critical path or parallel" question changes.

---

## 6. Decision-forcing questions for CEO

1. **Partial vs. full launch scope** (per §5). If partial: what certificate language do we use for D1–D3 only? Recommend *"certificate of assessed competency, Dimensions 1–3 (v1.0)"* with a public statement that D4–D6 will be added as they land.
2. **D4 Groble corroboration.** Does the CEO already have the Groble Volunteer Authority Model integrated into the cumulative source list, or is that a research spike we should scope as a blocker on the D4 translation issue?
3. **D6 dual-axis translation design.** The CEO is the framework author for the Loftus relational-boundary taxonomy layer. Does the CEO want to author the two-axis design doc first, review the CPO's draft of it, or delegate design to CPO with review at draft-2 of D6 probes?

---

## 7. Deliverables and issue graph

Child issues under GIV-628 (T2-H), sequenced by §3:

- **GIV-628-child-1: D5 Recognition, Retention & Culture — audience-tier translation** (assigned CPO). Acceptance: 16 probes × 4 bands, red-flag clauses complete, CEO sign-off, markdown + JSON draft committed.
- **GIV-628-child-2: D4 Performance, Impact & Accountability — audience-tier translation** (assigned CPO, blocked by D4-Groble corroboration spike if the CEO confirms one is needed). Acceptance: same shape as D5.
- **GIV-628-child-3: D6 Ethics, Equity & Advocacy — audience-tier translation** (assigned CPO, blocked by D6 dual-axis design doc — self-blocker unless CEO takes it). Acceptance: same shape as D5, plus both boundary-axis scores complete per probe.

GIV-628 is **blocked-by** all three children (parent-tracker pattern). Closes when all three are done and README build-status flips to ✅ for D4/D5/D6.

Parallelism: D5 can start immediately. D4 blocked on Groble input (CEO Q2 above). D6 blocked on dual-axis design (CEO Q3 above). No pipelining is possible on the authoring itself — the CPO authors sequentially — but the input gates for D4 and D6 can be resolved by the CEO in parallel with D5 authoring.

---

## 8. Out of scope for T2-H

- Post-pilot literature enhancements (psychological-contract for D5, volunteer–staff conflict for D4, digital-volunteer probes for D2/D3). These sharpen levelling after real pilot data.
- D1 pressure-test and D2 structural upgrades (README §Immediate Priorities) — separate CPO workstream, not part of T2-H.
- Content-model split into `content/dimensions/*.md` files (F4 from the 2026-07-02 stock-take). Authored markdown + JSON is drop-in for F4 once shipped; we don't gate T2-H on F4.

---

## 9. Success signal

The board asked whether Volo Index is customer-ready. The T2-H answer is: *"content-side, the honest scope of what customers can be certified on is a knob we can turn — from D1–D3 today to full D1–D6 as D5, D4, D6 land in that order. The certificate copy adapts to the scope. The rest of Tranche 2 (backend, UI, cert issuance, sharing) determines whether they can experience it at all."*

T2-H does not gate launch by default; it gates the marketing claim about launch scope.

---

*Attached to GIV-628. Child issues carry the per-dimension acceptance criteria. Revisions land in Paperclip documents once GIV-628's document surface exists; interim edits happen here.*
