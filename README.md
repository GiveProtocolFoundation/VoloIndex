# Volo Index

[![CI](https://github.com/GiveProtocolFoundation/VoloIndex/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/GiveProtocolFoundation/VoloIndex/actions/workflows/ci.yml)

> An assessment-based certificate program for volunteer leaders, coordinators, and program directors — built from the research literature up, not from convention down.

---

## What This Is

Volo Index is a multi-tier volunteer-management competency assessment. Unlike existing credentialing programs, it is grounded in peer-reviewed research and practitioner literature — synthesized into a competency framework that scales from team leads to directors.

Practitioners demonstrate competency through scenario-based probes and receive a **certificate of assessed competency** reflecting their profile across six dimensions and four developmental levels.

The platform is being developed by a practitioner with direct experience in volunteer management and a strong interest in the field, using AI-assisted literature synthesis to achieve expert-level depth without requiring the builder to be the world's foremost authority on every dimension.

> **Design principle:** The assessment content emerges from the research, not the other way around. Each dimension is anchored in the literature before assessment questions are written.

---

## Platform Classification

**Volo Index is an assessment-based certificate program.** It issues a *certificate of assessed competency* — not a professional certification.

- Practitioners demonstrate competency via scenario-based assessment and receive a certificate reflecting their tier profile across the six dimensions.
- It is not subject to ICE/ANSI-style accreditation norms, and no formal job or practice analysis is required for v1.0.
- The research-anchored methodology — literature-before-drafting, with peer-reviewed source coverage — is the validity argument, which is stronger in practice than most accreditation-process credentials.
- A path to full certification remains open: the existing research architecture would satisfy a practice-analysis requirement more readily than a conventionally built credential. That is a later-version decision, not a launch constraint.

> **Language note:** Project materials describe Volo Index as issuing a *certificate of assessed competency*. We avoid "certifying practitioners."

---

## Two Scoring Axes

Every practitioner is assessed along two independent four-part axes.

### Developmental Level — how well a competency is performed

| Level | Score Range | Description |
|-------|-------------|-------------|
| **Foundational** | 1.0 – 3.0 | Basic awareness; instinct-driven; conflates volunteer and employee management |
| **Developing** | 3.1 – 5.5 | Understands principles; inconsistent application; reactive to intentional transition |
| **Proficient** | 5.6 – 7.5 | Consistent, intentional practice; can articulate reasoning; adapts to context |
| **Expert** | 7.6 – 10.0 | Evaluates systems; designs programs; advocates at strategic level; mentors others |

> Scores are deliberately hard to reach at Expert level — breadth and depth both required.

### Audience Scope Band — the breadth of responsibility assessed

| Band | Audience | Focus |
|------|----------|-------|
| Team Lead | Leads a small volunteer team | Direct, hands-on leadership; assessed on evidence over vocabulary |
| Coordinator | Volunteer coordinators | Day-to-day management; operational proficiency |
| Program Manager | Program managers | Cross-team oversight; developing strategic framing |
| Director | Directors & executives | Org-level design; advocacy; culture and infrastructure |

A cross-cutting **scope boundary-awareness rule (locked v1.0)** runs framework-wide: substantive escalation protects the floor, while uncorrected miscalibration caps a sub-domain at Proficient. Probes and whole sub-domains may legitimately thin or drop at lower bands without breaking a dimension's spine.

---

## Assessment Dimensions

### Dimension 1 — Strategic Engagement Design
Connects volunteer engagement to organizational mission and strategy. Covers org readiness assessment, identifying where volunteers create genuine value, setting program goals, and building the internal case for investing in the volunteer function.

### Dimension 2 — Recruitment, Matching & Onboarding
Attracts the right volunteers, matches them to roles that fit their motivations and skills, and onboards them in a way that sets up long-term success. Goes beyond posting opportunities to understanding the full pipeline from attraction to integration.

### Dimension 3 — Training, Development & Role Support
Prepares volunteers for their roles and supports ongoing growth — without the leverage of a paycheck. Covers orientation design, coaching, identifying support needs, and creating development pathways that keep experienced volunteers engaged.

### Dimension 4 — Performance, Impact & Accountability
Manages volunteer performance, measures impact, and maintains accountability within the unique constraints of a volunteer relationship. Covers expectation-setting, feedback, underperformance, impact reporting, and communicating the program's value.

### Dimension 5 — Recognition, Retention & Culture
Sustains volunteer commitment through meaningful recognition, strong retention practices, and a healthy organizational culture. Covers motivation-matched recognition, diagnosing flight risk, and building belonging across paid staff and volunteers.

### Dimension 6 — Ethics, Equity & Advocacy
Navigates the ethical complexities of leading unpaid contributors, ensures equitable access to volunteer opportunities, and advocates for the volunteer function. Covers power dynamics, inclusive design, data privacy, and fighting for program resources.

---

## Build Status by Dimension

**All six single-progression drafts exist. Three of six dimensions (D1, D2, D3) are fully audience-tier translated (16/16 probes each). Zero remaining literature gaps framework-wide.**

| Dimension | Draft | Audience-tier translation | Remaining gap |
|-----------|-------|---------------------------|---------------|
| D1 Strategic Engagement Design | 🟢 v0.1 | ✅ 4 tiers · 16/16 probes | None — pressure-test pending |
| D2 Recruitment, Matching & Onboarding | 🟢 v0.3 · pressure-tested | ✅ 4 tiers · 16/16 probes | Structural upgrades identified before scored piloting |
| D3 Training, Development & Role Support | 🟢 v0.1 (provisional) | ✅ 4 tiers · 16/16 probes | Adult-learning & role-design literature (post-pilot; sharpens leveling) |
| D4 Performance, Impact & Accountability | 🟢 v0.1 | ✅ 4 tiers · 16/16 probes (pending CEO sign-off) | Post-pilot volunteer–staff conflict resolution literature (out of T2-H scope) |
| D5 Recognition, Retention & Culture | 🟢 v0.1 | ✅ 4 tiers · 16/16 probes (r1, CEO signed off) | Psychological-contract literature (post-pilot) |
| D6 Ethics, Equity & Advocacy | 🟢 v0.1 (deepest-sourced) | ✅ 4 tiers · 16/16 probes · dual-axis (r1.1, CEO signed off) | None — all probes fully sourced |

*Legend: 🟢 Drafted / ready · ✅ translated · ⬜ translation pending. D6 is a special case for translation — it runs scope boundary-awareness and relational boundary-awareness (Loftus taxonomy) simultaneously, scored on separate axes.*

---

## Immediate Priorities

- [x] Audience-tier translate **D5** next — it shares the autonomy / over-management second axis with D3, so that scoring machinery should recur (r1 CEO signed off)
- [x] Audience-tier translate **D4** — corroborate the Groble Volunteer Authority Model on the cumulative source list first (r1 CEO signed off)
- [x] Audience-tier translate **D6** last — dual boundary-awareness special case (scope + relational, scored separately) (r1.1 CEO signed off)
- [ ] Apply D2's identified structural upgrades and run the D1 pressure-test before scored piloting

### Post-Pilot Enhancements (not blocking v1.0)

- D2: Volunteer Functions Inventory integration; risk-reduction-as-recruitment probes
- D3: adult learning theory and role-design literature (re-level D3 afterward)
- D4: volunteer–staff conflict resolution
- D5: psychological-contract literature and risk-propensity-differentiated retention
- D2/D3: digital volunteer management probes

---

## License

Volo Index uses a dual license because the repository holds two different kinds of work:

- **Code** (SPA source, build tooling, CI, and any code that renders or scores the framework) — [Apache License 2.0](LICENSE).
- **Content** (the six dimensions, probe sets, scoring rubric, prose in this README and `docs/`, and the "Lift" brand assets in `Assets/`) — [Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)](LICENSE-CONTENT).

See [`NOTICE`](NOTICE) for attribution guidance when redistributing either.

---

*This README is a living document and will be updated as new research is synthesized and dimensions are built out.*
