# Operator Review SOP — Publication Queue (DPIA R-01)

**Version:** 1.1 (Head of Data review — §4.3 audit-integrity note, §7 auto-publish reframed)  
**Date:** 2026-07-25  
**Owner:** Head of Data  
**Ref:** GIV-741 / GIV-736 / DPIA R-01 (GIV-734)

---

## 1. Purpose

This SOP governs the human review step that stands between a completed candidate assessment and its public publication. It exists to satisfy Art. 22 GDPR (meaningful human oversight of automated decision-making) and to close DPIA residual risk R-01.

Every assessment that a candidate opts in to publish **must** pass through this review before a certificate is issued or any result is visible publicly. No technical bypass exists — the system enforces this constraint at the database level (see §4).

---

## 2. Who performs the review

The review is performed by the **operator** (currently the CTO or a named delegate with equivalent authority). Access is controlled by the `INTERNAL_API_KEY` server secret — only persons who hold this key can take release or reject actions.

The key is provisioned at deployment time (`INTERNAL_API_KEY` environment variable on `voloindex-prod`). It must not be shared beyond the designated reviewer(s). If a reviewer leaves or the key is compromised, rotate immediately via `flyctl secrets set INTERNAL_API_KEY=<new>`.

---

## 3. Review interface

Navigate to `/qa-review.html` on the live instance (e.g. `https://voloindex.org/qa-review.html`). The page prompts for the internal key on first load; the key is stored in `sessionStorage` for the browser session only and is never transmitted except as the `X-Internal-Key` request header.

The queue shows all entries with status `pending_review`, ordered by submission time (oldest first). For each entry the reviewer sees:

- Candidate identifier and session ID
- Submission timestamp
- Overall score and tier (Foundational / Developing / Proficient / Expert)
- Dimension-level score table
- All extracted signals with strength and valence (positive / negative)
- Full interview transcript

---

## 4. Review criteria

For each pending entry the reviewer must reach one of three decisions:

### 4.1 Agree (release — agreed with extractor)

The AI extractor's signal interpretation is correct and the assessment result is a fair representation of the candidate's demonstrated knowledge. The transcript contains nothing that warrants redaction or rejection.

Use the **"Agree with extractor"** button. The entry transitions to `published`, a certificate is issued immediately, and `agreed_with_extractor = TRUE` is recorded.

### 4.2 Disagree (release — disagreed with extractor)

The AI extractor made scoring errors (missed signals, mis-classified strength or valence, applied the wrong rubric rule) but the transcript is otherwise clean and the candidate consented to publication. The reviewer disagrees with the automated verdict but nonetheless releases the result for the candidate's benefit.

Use the **"Disagree"** button. The entry transitions to `published`, a certificate is issued, and `agreed_with_extractor = FALSE` is recorded. The disagreement rate feeds back into quality monitoring (auto-publish latch requires ≥ 95 % agreement over the first 50 reviews).

> **Note:** Disagreement does not recompute the score. If a scoring error is serious enough that the published result would materially misrepresent the candidate, use **Reject** instead and create an ops ticket to re-score.

### 4.3 Reject — do not publish

Use when **any** of the following conditions apply:

| Condition | Notes |
|-----------|-------|
| **Art. 9 special-category content** in the transcript that the candidate likely volunteered inadvertently (health, race/ethnicity, political opinion, religion, sexual orientation, biometric identifiers, criminal history) | Reject and/or redact before a re-submission can be considered — see §3.1 |
| Consent was not freely given or the candidate is demonstrably under 16 | Platform gate should prevent under-16 submissions; reject if it slips through |
| Transcript is incoherent, spam, or clearly not a genuine assessment attempt | |
| Extractor produced a fabricated or hallucinated result not grounded in the transcript | |
| Technical artefact (duplicate session, corrupted transcript) | |

Click **"Reject — do not publish"**. A prompt asks for a reason. **Recording a meaningful reason is a mandatory procedural control** (not just "rejected") — it is the audit record of *why* publication was refused. The reason is stored in `rejection_reason` alongside the `rejected_at` timestamp.

> **Enforcement note:** the server does not currently reject an empty reason — an empty string is stored as `NULL` (`reason || null` in `publication.js` and `qa-review.html`). Operators MUST NOT leave the reason blank; a substantive reason is required by this SOP. A server-side non-empty-reason check is recommended as a hardening follow-up so the audit record cannot be null.

**A rejected entry can never be published.** The `rejected_at` / `rejection_reason` columns are set and the status transitions to `rejected` permanently. No certificate is issued (both issuance code paths check `status = 'published'`).

#### 3.1 Art. 9 content — redact then consider

If special-category content is spotted but the rest of the transcript is acceptable, the reviewer may:

1. First call `POST /api/sessions/:id/redact` with `{ turnIndexes: [...] }` to scrub the specific candidate turn(s) — this removes the verbatim text from `transcript_turns`, the `transcripts` snapshot, and any quoted spans in `score_results` signals.
2. Then **Agree** or **Disagree** (release) the entry if the remainder is clean.

If the Art. 9 content is pervasive or intertwined with scored signals, **Reject** instead and note the reason.

---

## 5. Logging and audit

Every decision is durably recorded in the `publication_queue` table in Neon Postgres:

| Column | Populated on |
|--------|-------------|
| `status` | Always: `pending_review` → `published` or `rejected` |
| `released_at` | Release (agree or disagree) |
| `agreed_with_extractor` | Release: `TRUE` / `FALSE` |
| `rejected_at` | Reject |
| `rejection_reason` | Reject |
| `enqueued_at` | Enqueue (immutable) |

The `GET /api/publication` endpoint returns aggregate stats (pending count, published count, agreement rate, auto-publish latch state) which can be queried at any time for operational monitoring.

For GDPR Art. 22 audit purposes the full row history is retained in the database. Retention schedule follows the schedule in RoPA A.6 (GIV-737).

---

## 6. No-bypass statement

Certificate issuance is gated on `status = 'published'` by the `issueCertificateForSession` function (`src/server/routes/publication.js`). This function is called only from the `/release` route, which in turn requires a valid `X-Internal-Key` header (enforced by the `requireInternal` middleware in `src/server/middleware/auth.js`). The `/reject` route transitions status to `rejected` and does not call the cert-issuance function.

There is no alternative code path that issues a certificate or makes a result publicly visible without the entry first reaching `status = 'published'` through an authenticated operator release.

The public credential lookup (`GET /api/credentials/:certId`) queries the `certificates` table, which is populated exclusively by the cert-issuance function called post-release.

---

## 7. Auto-publish latch — DISABLED in production

The stats endpoint (`GET /api/publication`) computes an `autoPublishEnabled` flag once ≥ 50 entries have been reviewed at an agreement rate ≥ 95 %, and `qa-review.html` surfaces it in the stats bar. **This flag is display-only. It does NOT change queue behaviour:** `POST /api/publication/enqueue` unconditionally sets `status = 'pending_review'`, so in the live (database-backed) serving path every entry is held for operator review and nothing is ever auto-published.

Auto-publish — releasing an entry without individual operator review — is **incompatible with DPIA residual risk R-01 and with the binding Art. 13 commitment in the privacy notice §6 that "every publication passes a human review step before going live."** It therefore MUST NOT be enabled in production. Enabling it would remove the Art. 22 human safeguard this SOP documents, and would require a fresh DPIA re-assessment and an updated privacy notice before it could lawfully operate.

> **Implementation note (CTO follow-up):** a dormant in-memory model, `src/assessment/publication-queue.js`, contains an auto-publish branch that flips `status` to `published` on enqueue once the latch trips. It is **not** wired into the server (the live path uses the database-backed `routes/publication.js`), but because it is exported from `src/assessment/index.js` it should be removed or guarded so it cannot be silently brought into the serving path.

Regardless of the latch flag, the manual controls in this SOP remain available at all times: operators can list the queue (`/pending`), reject entries (`/reject`), and redact Art. 9 content (`POST /api/sessions/:id/redact`).

---

## 8. Review cadence

Reviews should be completed within **2 working days** of an entry appearing in the queue. Candidates are not notified of publication until the entry is released; extended delays effectively deny them the use of their certificate. Set up an alert or daily check against `GET /api/publication` (`pendingCount > 0`) during the manual-review period.

---

*This SOP is R-01 closure evidence for the Volo Index DPIA (GIV-734). Reviewed and signed off by the Head of Data on 2026-07-25 (v1.1). It must be updated whenever the publication latch implementation changes; auto-publish must not be enabled without a DPIA re-assessment (see §7).*
