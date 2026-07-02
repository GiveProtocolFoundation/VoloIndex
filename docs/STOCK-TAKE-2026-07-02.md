# Volo Index — Stock-Take and Paperclip-Centered Path Forward

**Author:** CTO / Founding Engineer, Give Protocol Foundation
**Date:** 2026-07-02
**Issue:** [GIV-60](/GIV/issues/GIV-60)
**Status of this document:** initial CTO stock-take, open to CEO edits

---

## 1. Purpose

Establish a shared, honest picture of what actually exists in Volo Index today, then propose the concrete steps required to make **Paperclip** the primary place where all future Volo Index work — product, research, engineering, and community — is planned, executed, and reviewed.

This is a working-artifact stock-take, not marketing copy.

---

## 2. What Exists Today

### 2.1 Product / Content

- **Domain live:** [voloindex.org](https://voloindex.org/) serves a self-contained React SPA. The whole app is inlined into a single `index.html` (~890 KB) that unpacks base64 + gzip assets client-side at load.
- **Positioning:** *"An assessment-based certificate program for volunteer leaders, coordinators, and program directors — built from the research literature up, not from convention down."*
- **Framework maturity (per repo README):**
  - 6 of 6 dimension drafts written.
  - 3 of 6 dimensions (D1 Strategic Engagement Design, D2 Recruitment/Matching/Onboarding, D3 Training/Development/Role Support) are audience-tier translated — 16/16 probes each.
  - 3 remaining (D4, D5, D6) have drafts but no audience-tier translation yet.
  - Two scoring axes locked v1.0: Developmental Level (Foundational → Expert) × Audience Scope Band (Team Lead → Director).
  - Scope-boundary-awareness rule locked framework-wide.
- **Not yet in the codebase:** scored piloting infrastructure, practitioner accounts, probe delivery UI, certificate issuance, admin/review tooling.

### 2.2 Code and Repo

- **Repo:** `GiveProtocolFoundation/VoloIndex` on GitHub, `main` = `0d0ecfd`, 38 commits.
- **Top level:** `README.md`, `index.html`, `Assets/`, `.gitignore`.
- **Build system:** none checked in. `index.html` is a static artifact produced elsewhere; the source that generates it is not in the repo. There are legacy `src/`, `wrangler.jsonc`, and Cloudflare Workers artifacts in history (all removed) — deployment is now Cloudflare Pages of the static `index.html`.
- **CI/CD:** none.
- **Tests:** none.
- **License:** none declared.
- **Contributor docs:** none (no CONTRIBUTING, no CODE_OF_CONDUCT, no issue templates).
- **Branches on origin:** `main`, plus stale `claude/*` feature branches and `cloudflare/workers-autoconfig` that can be pruned.

### 2.3 Brand and Identity

- Complete mark set ("Lift" — three concentric arcs) in `Assets/`, both light and dark variants, favicons, apple-touch, PWA icon, wordmark lockups.
- Documented palette (tan → amber → clay ink, paper background) mapped to the tier scale.
- Wordmark set in Spectral SemiBold.
- **Verdict:** brand identity is the most mature layer of the project.

### 2.4 Paperclip Integration (current state)

- Project **VoloIndex** exists in Paperclip (id `7fd06a92-…`), pointed at `/home/muttacago/VoloIndex/` and the GitHub repo.
- Primary workspace `c69473cf-…` is wired.
- One issue currently active: **GIV-60** (this stock-take).
- No goals, no plan documents, no child issues, no contributor-facing labels yet.
- Two recent runs (CEO adapter + CTO adapter) failed with `workspace_validation_failed` because the local checkout was missing `.git` metadata at the time of the run.

---

## 3. Gaps That Actually Matter

Ranked by how badly they block "Paperclip as the center of future development."

| # | Gap | Why it blocks Paperclip-centric work |
|---|-----|--------------------------------------|
| 1 | **No source tree.** `index.html` is a compiled artifact; the code that produces it is not in the repo. | Paperclip can plan and track issues, but agents can't ship meaningful diffs against a bundle blob. Every feature request degenerates into "edit the giant HTML file." |
| 2 | **No build/CI.** No `package.json`, no lockfile, no deploy pipeline, no linter, no typecheck. | Nothing to run in a heartbeat to prove a change is safe. Agents ship blind, humans review blind. |
| 3 | **No LICENSE and no CONTRIBUTING.** | "Open source by default" is aspirational, not legally true. Volunteers cannot contribute in good faith. |
| 4 | **No issue backlog structure.** GIV-60 is the only issue; there are no goals, no dimensions-as-workstreams, no research vs. product vs. infra split. | Paperclip is optimized around a backlog; without one it can't allocate agent effort. |
| 5 | **Workspace validation instability.** Local repo drifted from `origin/main` (unrelated init commit) and had no remote configured; agents kept failing on this. | Every heartbeat starts from a broken workspace, wasting runs. |
| 6 | **Content authority split.** The dimensions research (D1–D6, probe sets, source list) lives partly in the SPA, partly in the README, partly in the author's head. | Paperclip agents can't reason over content they can't see. |
| 7 | **No public roadmap.** | Neither the community nor Paperclip agents can pull the next task from a shared queue. |

---

## 4. Recovery Action Just Taken

To unblock the immediate `workspace_validation_failed` state:

1. Confirmed local `/home/muttacago/VoloIndex/.git` is present and clean.
2. Added the missing `origin` remote: `https://github.com/GiveProtocolFoundation/VoloIndex.git`.
3. Fetched all refs — found 38 commits on `origin/main` and several stale feature branches.
4. Reset local `main` to `origin/main` (`0d0ecfd`). The pre-existing local `c9a7fd4` "Initial commit" was an unrelated single-commit history with only the `assets/` folder; it contained no work not already present on origin, so the reset is non-destructive to project value.
5. Verified the working tree now matches origin (`README.md`, `index.html`, `Assets/`, `.gitignore`).

Ongoing: the `workspace_validation` recovery action `c408800c-…` should be closable now, as the underlying cause (missing `.git` + missing remote) is resolved.

---

## 5. Proposal — Making Paperclip the Center

Two horizons. Everything is a child issue of a top-level Paperclip goal so the graph is navigable.

### Horizon 1 — Foundational (do these first, in this order)

**F1. Extract the source of `index.html`.** The current bundle-in-HTML approach is fine as a *deploy artifact* but must not be the *source of truth*. Import the actual React project (component tree, styles, content JSON) into `src/`. If the original source is lost, treat the SPA as v0 output and start a `src/` from a minimal Vite + React scaffold that renders the same content from structured JSON. *Owner: CTO. Delegate to future frontend hire once queued work justifies one.*

**F2. Add `LICENSE` + `CONTRIBUTING.md` + `CODE_OF_CONDUCT.md`.** Recommend Apache-2.0 for the code, CC BY-SA 4.0 for the framework and probe content — matches "public goods" positioning and lets volunteer researchers contribute. *CEO decision on license, then CTO ships.*

**F3. CI baseline.** GitHub Actions workflow that on every PR runs: install → typecheck → lint → build → upload artifact. No tests required at this stage, but the scaffolding is. *CTO.*

**F4. Content model split.** Move dimensions/probes/scoring rubric out of the SPA and into content files (`content/dimensions/D1.md`, `content/probes/D1.json`, `content/rubric.yaml`) that the SPA imports at build time. This is what makes it possible for research contributors (including the CEO) to edit content without touching the app. *CTO.*

**F5. Paperclip backlog seed.** Create these permanent workstreams as goals in Paperclip:
- `Research` — dimensions D4/D5/D6 audience-tier translation, D1 pressure-test, D2 structural upgrades
- `Product` — probe delivery UI, practitioner accounts, certificate issuance
- `Infra` — build, CI, deploy, observability
- `Community` — contributor docs, issue templates, public roadmap
*CTO seeds; CEO approves.*

### Horizon 2 — Growth (queue after Horizon 1 lands)

- **G1.** Piloting harness for scored assessments (D1 first).
- **G2.** Practitioner auth + result storage. Flag: this is the first surface that touches donor/practitioner data — will require an explicit security review before ship.
- **G3.** Reviewer/admin tooling for probe grading.
- **G4.** Public content contribution flow (PR → preview build → CEO merge).
- **G5.** First engineering hire proposal (see §7).

---

## 6. What "Paperclip as the Center" Actually Means

Concretely, when we say Paperclip is the center of Volo Index:

1. **Every unit of work is a Paperclip issue.** Research probe drafts, content edits, code changes, licensing decisions — all issues, all in this project.
2. **Every merged PR references an issue.** Enforced by PR template.
3. **Goals are the roadmap.** The four workstreams in F5 are the only roadmap Volo Index has externally. If it isn't in Paperclip, it isn't happening.
4. **Agents pull from the backlog, not from inbox.** CTO/CEO agents wake on assigned issues; they don't wander.
5. **Community contributions land as issues first.** External volunteers open an issue; a Paperclip agent triages, labels, and either delegates or takes it.
6. **Documents (plans, RFCs, stock-takes like this one) live as Paperclip documents attached to their driving issue, not as loose files.** This file is the exception because it's the first — future ones live in Paperclip.

---

## 7. Hiring Signal (for CEO)

I am not asking for a hire today. I am flagging the trigger:

> When Horizon 1 items F1 + F4 land and the F5 backlog has ≥ 10 open frontend/product issues that a CTO cannot ship alongside content and infra work, propose a **founding frontend engineer** to the CEO with a role spec.

Until then, one CTO on the code is right-sized.

---

## 8. Immediate Next Actions (this week)

Concrete, ordered, mine to execute unless otherwise noted:

1. **[CTO]** Close the `workspace_validation` recovery action on GIV-60 with resolution note pointing at §4 of this document.
2. **[CTO]** Open child issues for F1, F2, F3, F4, F5. Link each as blocker-of the appropriate Horizon 1 acceptance state.
3. **[CEO decision needed]** License choice: Apache-2.0 for code + CC BY-SA 4.0 for content — approve or counter. This is the only Horizon 1 item I cannot start without you.
4. **[CTO]** Once F5 lands, seed the four workstream goals and start migrating the priorities already listed in `README.md` §"Immediate Priorities" into `Research` issues.
5. **[CTO]** Prune stale `claude/*` and `cloudflare/workers-autoconfig` branches on origin.

---

## 9. Risks and Watch-outs

- **Content-vs-code confusion.** The most valuable IP in Volo Index right now is the research synthesis, not the code. F4 (content model split) exists to keep that IP mergeable and reviewable without engineer bottleneck.
- **Single-HTML deploy artifact.** Convenient today, brittle tomorrow. Anything beyond a static marketing page will force a real frontend project. Doing F1 late costs more than doing it early.
- **Volunteer-data surface.** The moment we store any practitioner assessment result, we're in donor-data-adjacent territory (per my mandate: flag security-sensitive surfaces). G2 gets an explicit security review; it does not slip in as a Horizon 1 item without that gate.
- **Solo-founder bottleneck.** CEO is the sole domain authority for the research framework. F4 mitigates this by letting the CEO edit content in plain files without touching React.

---

*End of stock-take. Attach comments or edits directly on GIV-60; future revisions live as Paperclip documents.*
