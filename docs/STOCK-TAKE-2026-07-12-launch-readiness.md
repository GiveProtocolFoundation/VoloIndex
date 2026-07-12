# Volo Index — Customer Launch Readiness Stock-Take

**Date:** 2026-07-12 · **Author:** CTO · **Trigger:** Board comment on GIV-542 ("site still does not appear to be ready for customers")

This document maps the full customer journey the board described — *request an assessment → practice → live chat assessment → feedback & follow-ups → evaluation → certification → sharing (LinkedIn)* — against what is actually built, and defines the tranche needed to close the gap.

---

## 1. What exists today (verified on `main` @ 7434c94)

| Layer | Status | Evidence |
|---|---|---|
| **Scoring engine v1.2** | ✅ Production-validated | `src/scoring/` — 309/309 tests, HoData §9 validation, gate open |
| **Assessment Engine v1 (library)** | ✅ Shipped, gate open | `src/assessment/` — Sonnet 4.6 interviewer, chat controller, signal extractor, anti-hallucination verbatim-span gate, cost caps ($0.50/$2.00), consent-gated transcripts, publication queue (first-50 QA hold) |
| **Assessment content** | 🟡 Partial | 6 dimensions drafted; **only D1–D3 audience-tier translated (16/16 probes)**; D4–D6 translation pending |
| **Landing page** | 🟡 Static artifact only | `index.html` — brand splash, no product functionality |
| **Brand assets** | ✅ | `Assets/` — marks, lockups, favicons |
| **CI** | ✅ | GitHub Actions on `GiveProtocolFoundation/VoloIndex` |

**The critical fact:** everything above the content row is a **Node library with no delivery surface**. There is no HTTP server, no database (`InMemoryTranscriptStore` / `FileTranscriptStore` are explicitly stopgaps — see `src/assessment/consent-store.js:132`), no frontend beyond a splash page, no accounts, no payments, no certificates, no sharing. A customer visiting the site today can do nothing.

---

## 2. Journey gap map

| # | Journey step (board's words) | What's needed | Built? |
|---|---|---|---|
| 1 | **Request an assessment** | Account creation/sign-in, assessment request flow, entitlement (free/paid — board decision), scheduling or instant-start | ❌ Nothing |
| 2 | **Play** (practice mode) | Untimed/unscored demo interview on 1 dimension, clearly labelled, no certificate output; doubles as marketing funnel | ❌ Nothing |
| 3 | **Take a live assessment** | Web chat UI streaming to the interviewer; server-side session state; resume-after-disconnect; cost-cap surfacing | 🟡 Engine exists (`ChatInterviewController`); **no UI, no server, no persistence** |
| 4 | **Respond, get feedback, follow-up questions, further assessment** | Already the engine's core loop (probe → response → follow-up, per dimension, max-turns bounded) | ✅ Engine-level; ❌ no delivery surface |
| 5 | **Evaluation** | Extractor → validator → scoring engine → publication queue. Works end-to-end in-process | ✅ Engine-level; ❌ no persisted results, no results page |
| 6 | **Certification** | Certificate model (ID, holder, tier profile, issue date), render (PDF + badge image), public credential page, verification endpoint, revocation path. Language: *certificate of assessed competency* | ❌ Nothing |
| 7 | **Share on LinkedIn etc.** | See §3 | ❌ Nothing |
| — | **Cross-cutting** | Auth, DB, hosting/domain/TLS, rate limiting & abuse controls, ToS/privacy/consent copy, QA review UI for the first-50 queue, ops monitoring | ❌ Nothing |

Also content: a customer can only be credibly assessed on **D1–D3** today. D4–D6 need audience-tier translation before a full six-dimension certificate is honest.

---

## 3. LinkedIn sharing — how credentials are actually shared (design notes)

The proven patterns (Credly, Coursera, HubSpot Academy all use these):

1. **"Add to profile" deep link** — LinkedIn supports a prefilled Licenses & Certifications form via URL:
   `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name={cert name}&organizationName=Give%20Protocol%20Foundation&issueYear=..&issueMonth=..&certUrl={public credential URL}&certId={id}`
   Zero API integration, no LinkedIn partnership needed, works today. This is the workhorse. (An `organizationId` variant lights up the GPF logo once a LinkedIn Company Page exists — cheap prerequisite.)
2. **Feed share with rich card** — `https://www.linkedin.com/sharing/share-offsite/?url={credential URL}`. Requires the credential page to serve Open Graph tags (`og:title`, `og:description`, `og:image` at 1200×627). The badge/score-arc image is the asset that makes shares look good.
3. **Public credential page (the anchor for both)** — stable per-certificate URL, e.g. `voloindex.org/credential/{id}`: holder name (consented), tier profile visualization, issue date, verification status, "Add to LinkedIn profile" button, OG meta. This page IS the verification story — anyone clicking from LinkedIn lands on our proof.
4. **Badge image assets** — per-band/per-level badge PNGs derived from the existing brand marks; also used as `og:image`.
5. **Later (not launch-blocking):** Open Badges 3.0 / W3C Verifiable Credentials export for portability to Credly-class wallets.

**Launch requirement distilled:** items 1–4 need only a public credential page + deep-link construction + OG tags + badge renders. No LinkedIn API, no partner program. Reliable and easy.

---

## 4. Proposed Tranche 2 — "Customer-Facing Launch" (for board ratification)

| ID | Workstream | Scope | Owner (proposed) |
|---|---|---|---|
| T2-A | **Backend service + persistence** | HTTP API (sessions, chat turns via SSE/stream, results); Postgres (users, sessions, transcripts, scores, certificates); real `TranscriptStore` impl; rate limiting | Engineer |
| T2-B | **Assessment web app** | Request flow → consent screen → chat UI → progress → results dashboard; resumable sessions | Engineer 2 |
| T2-C | **Accounts & auth** | Magic-link email auth (lowest-friction v1), session tokens, entitlement flags | Engineer |
| T2-D | **Certification service** | Certificate model + issuance on publication-queue release, public credential page `/credential/{id}`, verification endpoint, PDF + badge render, revocation flag | Engineer 2 |
| T2-E | **Sharing** | LinkedIn Add-to-Profile deep link, share-offsite + OG cards, badge image assets, share UX on results page | Engineer 2 (after T2-D) |
| T2-F | **Practice mode ("play")** | 1-dimension unscored demo, clearly labelled, cost-capped tighter, funnel CTA | Engineer (after T2-A/B core) |
| T2-G | **Ops & deployment** | Hosting, domain, TLS, secrets mgmt (Anthropic key), monitoring, abuse controls | CTO |
| T2-H | **Content: D4–D6 tier translation** | Complete audience-tier translation so full 6-dimension certificates are defensible; interim option: launch with D1–D3 partial certificate | CPO |
| T2-I | **QA review UI for first-50 queue** | Minimal internal page for QA to work the D5 pending_review queue (currently no surface) | QA + Engineer |

**Board decisions needed before/during T2:**
1. **Pricing/payments** — free at launch vs. paid (payments adds Stripe + tax scope; recommend deferring payments to T3 and launching free/invite-limited).
2. **Launch scope** — wait for D4–D6 translation (full certificate) vs. launch D1–D3 partial certificate sooner.
3. **Domain** — confirm `voloindex.org` (or other) so credential URLs are stable forever (they end up on LinkedIn profiles; changing them later breaks shares).
4. **LinkedIn Company Page** for Give Protocol Foundation (needed for logo on profile entries).

**Dependency spine:** T2-A → {T2-B, T2-C} → T2-D → T2-E; T2-F and T2-I hang off T2-A/B; T2-G parallel; T2-H parallel (content).

---

## 5. Bottom line for the board

The **assessment brain is done and validated**; the **product around it is not started**. Nothing in the journey from "customer requests an assessment" to "certificate on LinkedIn" exists as customer-facing software yet. Tranche 2 above is the complete, ordered list of what stands between today's repo and a customer completing that journey. The LinkedIn story is low-risk: the standard Add-to-Profile deep link + a public credential page with OG tags covers reliable sharing with no LinkedIn partnership required.
