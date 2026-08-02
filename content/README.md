# Content Schema — Volo Index Framework

This directory holds all framework content as structured files consumed at build time.
No framework prose, probe text, or scoring logic lives inside `src/` React components.

> **Status:** Schema v0.1 — drafted ahead of F1 (GIV-66) source-tree extraction.
> Content files will be populated once `src/` scaffolding exists and the build pipeline
> can import from this directory.

---

## Directory Layout

```
content/
├── README.md              ← this file (schema reference)
├── rubric.yaml            ← two-axis scoring model (locked v1.0 rules)
├── sources.json           ← canonical bibliography
├── dimensions/
│   ├── D1.md              ← Strategic Engagement Design
│   ├── D2.md              ← Recruitment, Matching & Onboarding
│   ├── D3.md              ← Training, Development & Role Support
│   ├── D4.md              ← Performance, Impact & Accountability
│   ├── D5.md              ← Recognition, Retention & Culture
│   └── D6.md              ← Ethics, Equity & Advocacy
└── probes/
    ├── D1.json            ← 16 probes across 4 audience bands
    ├── D2.json
    ├── D3.json
    ├── D4.json
    ├── D5.json
    └── D6.json
```

---

## `content/dimensions/DX.md` — Dimension Description

Each dimension file is Markdown with a YAML front-matter block.

```markdown
---
id: D1
title: "Strategic Engagement Design"
version: "v0.1"
status: draft          # draft | ready | pressure-tested
audience_tier_translated: true   # true when all 4 bands × 4 levels done (16 probes)
literature_gaps: []    # free-text list of remaining source gaps, empty = none known
---

## Overview

Long-form description of the dimension: what it covers, why it matters,
how it connects to the broader framework.

## Source List

Annotated list of peer-reviewed and practitioner literature anchoring this dimension.
Format: Author (Year). Title. *Journal/Publisher*. DOI or URL if available.
Use the key from `sources.json` for each reference: e.g., `[@Groble2011]`.

## Leveling Notes

How Foundational / Developing / Proficient / Expert manifest specifically in
this dimension. Reference the `rubric.yaml` thresholds; add dimension-specific
calibration here.

## Audience Scope Notes

How the dimension's probe coverage shifts across Team Lead / Coordinator /
Program Manager / Director bands. Note any sub-domains that legitimately thin
or drop at lower bands without breaking the dimension's spine.
```

### Required front-matter fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | `D1`–`D6` |
| `title` | string | Display title |
| `version` | string | Semantic version of this dimension's content |
| `status` | enum | `draft` \| `ready` \| `pressure-tested` |
| `audience_tier_translated` | boolean | All 16 probes (4 bands × 4 levels) exist in `probes/DX.json` |
| `literature_gaps` | string[] | Known source gaps; empty array means none |

---

## `content/probes/DX.json` — Probe Set

Each probe file is a JSON array. One file per dimension (D1–D6), 16 probes when fully
audience-tier translated (4 developmental levels × 4 audience bands).

### Schema

```jsonc
[
  {
    "id": "D1-TL-F-01",
    "dimension_id": "D1",
    "prompt": "A volunteer coordinator asks you to describe how you'd assess
               whether your organization is ready to expand its volunteer program.
               Walk us through your thinking.",
    "audience_band": "team_lead",
    "developmental_level": "foundational",
    "source_refs": ["Hager2004", "Volunteer Canada 2012"],
    "scoring_notes": "Look for awareness of org capacity constraints. Expert anchors:
                      systematic readiness model, stakeholder mapping, resource audit."
  }
]
```

### Field reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | Format: `D{n}-{band_code}-{level_code}-{seq}` (e.g. `D1-TL-F-01`) |
| `dimension_id` | string | ✅ | `D1`–`D6` |
| `prompt` | string | ✅ | Scenario-based probe text shown to the practitioner |
| `audience_band` | enum | ✅ | See band codes below |
| `developmental_level` | enum | ✅ | See level codes below |
| `source_refs` | string[] | ✅ | Keys from `sources.json`; must be non-empty |
| `scoring_notes` | string | ✅ | Calibration guidance for scorers; anchors Expert behaviour |

### Enum values

**`audience_band`**

| Value | Code | Audience |
|-------|------|----------|
| `team_lead` | `TL` | Leads a small volunteer team |
| `coordinator` | `CO` | Volunteer coordinators |
| `program_manager` | `PM` | Program managers |
| `director` | `DI` | Directors & executives |

**`developmental_level`**

| Value | Code | Score Range |
|-------|------|-------------|
| `foundational` | `F` | 1.0 – 3.0 |
| `developing` | `DE` | 3.1 – 5.5 |
| `proficient` | `PR` | 5.6 – 7.5 |
| `expert` | `EX` | 7.6 – 10.0 |

### Probe ID convention

`D{dimension}-{band_code}-{level_code}-{seq:02d}`

Examples: `D1-TL-F-01`, `D3-PM-PR-02`, `D6-DI-EX-01`

Sequence numbers are per `(dimension, band, level)` tuple and start at `01`.

---

## `content/rubric.yaml` — Two-Axis Scoring Model

```yaml
# rubric.yaml — Volo Index Scoring Model (locked v1.0)
version: "1.0"
locked: true   # changes to this file require CTO sign-off and a version bump

developmental_levels:
  - id: foundational
    label: "Foundational"
    score_min: 1.0
    score_max: 3.0
    description: >
      Basic awareness; instinct-driven; conflates volunteer and employee
      management practices.

  - id: developing
    label: "Developing"
    score_min: 3.1
    score_max: 5.5
    description: >
      Understands principles; inconsistent application; reactive to intentional
      transition in practice.

  - id: proficient
    label: "Proficient"
    score_min: 5.6
    score_max: 7.5
    description: >
      Consistent, intentional practice; can articulate reasoning; adapts to
      context across most scenarios.

  - id: expert
    label: "Expert"
    score_min: 7.6
    score_max: 10.0
    description: >
      Evaluates systems; designs programs; advocates at strategic level;
      mentors others. Breadth and depth both required — Expert is deliberately
      hard to reach.

audience_scope_bands:
  - id: team_lead
    label: "Team Lead"
    description: "Leads a small volunteer team. Assessed on evidence over vocabulary."

  - id: coordinator
    label: "Coordinator"
    description: "Volunteer coordinators. Day-to-day management; operational proficiency."

  - id: program_manager
    label: "Program Manager"
    description: "Cross-team oversight; developing strategic framing."

  - id: director
    label: "Director"
    description: "Directors & executives. Org-level design; advocacy; culture and infrastructure."

scope_boundary_awareness_rule:
  locked: true
  description: >
    Cross-cutting rule applied framework-wide (all six dimensions, all bands).
    Substantive escalation of a probe to a higher-scope level protects the
    practitioner's floor score for that probe. Uncorrected miscalibration
    (responding as a role one does not hold without acknowledgement) caps the
    relevant sub-domain at Proficient. Probes and whole sub-domains may
    legitimately thin or drop at lower audience bands without breaking a
    dimension's spine.
```

---

## `content/sources.json` — Canonical Bibliography

```json
{
  "$schema": "https://voloindex.org/schemas/sources/v1",
  "version": "1.0",
  "sources": [
    {
      "key": "Hager2004",
      "authors": ["Mark A. Hager", "Jeffrey L. Brudney"],
      "year": 2004,
      "title": "Volunteer Management Practices and Retention of Volunteers",
      "publisher": "Urban Institute",
      "url": "https://www.urban.org/research/publication/volunteer-management-practices-and-retention-volunteers",
      "dimensions": ["D1", "D2", "D5"]
    }
  ]
}
```

### Field reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | string | ✅ | Short citation key used in `source_refs` arrays (e.g. `Hager2004`) |
| `authors` | string[] | ✅ | Full author names |
| `year` | integer | ✅ | Publication year |
| `title` | string | ✅ | Full title |
| `publisher` | string | ✅ | Journal, publisher, or organisation |
| `url` | string | — | Canonical URL or DOI |
| `dimensions` | string[] | ✅ | Which dimensions (`D1`–`D6`) cite this source |

---

## Build-time consumption (once F1 / GIV-66 lands)

When the `src/` scaffold exists, the build pipeline will:

1. Import `content/dimensions/DX.md` front-matter and body via a Markdown loader.
2. Import `content/probes/DX.json` as typed arrays.
3. Import `content/rubric.yaml` as a typed config object.
4. Import `content/sources.json` and resolve `source_refs` keys at build time.

No framework content should remain hardcoded in React components after F4 (GIV-69) is complete.

> **See also:** GIV-66 (F1 — source tree extraction), GIV-69 (F4 — this issue).

---

## Content Authoring Workflow (CEO / researcher path)

To update a probe without touching TypeScript:

1. Edit `content/probes/DX.json` — add, remove, or modify probe objects.
2. Open a PR. CI will validate the JSON against the probe schema.
3. The preview build (configured in F1 / GIV-66) will render the change.
4. Merge after review. No engineer involvement needed.

To update a dimension description:

1. Edit `content/dimensions/DX.md`.
2. Open a PR. The Markdown is rendered directly; no schema validation beyond front-matter required.

To add a bibliography entry:

1. Add to `content/sources.json`.
2. Reference the new `key` from the relevant probe's `source_refs`.

---

*Schema v0.1 — authored ahead of GIV-66 (F1) to allow CEO review of the content shape before implementation begins.*
