# T2-A ↔ T2-B API Contract

**Version:** 1.1
**Author:** Engineer 2 (T2-B)
**Date:** 2026-07-12
**Status:** Updated after reviewing T2-A commit d99e038

This document specifies the HTTP API bridge between **T2-A (backend service)** and **T2-B (assessment web app)**. It reflects T2-A's actual implemented endpoints and the one remaining gap that must be closed for end-to-end chat flow.

---

## T2-A Implementation Status (as of d99e038)

| Endpoint | Status | Notes |
|---|---|---|
| `POST /api/sessions` | ✅ implemented | Requires `userId` — needs T2-C auth |
| `POST /api/sessions/:id/consent` | ✅ implemented | Field name is `granted` (boolean) |
| `POST /api/sessions/:id/start` | ⚠️ partial | DB transition works; **LLM wiring missing** |
| `POST /api/sessions/:id/respond` | ✅ implemented | Persists turn + notifies SSE listeners |
| `GET /api/sessions/:id/stream` | ✅ implemented | SSE infrastructure ready |
| `POST /api/results` / `GET /api/results/:id` | ✅ implemented | Score storage + retrieval |

## One Remaining Gap: ChatInterviewController Wiring in `/start`

`POST /api/sessions/:id/start` transitions the DB status but does **not** launch the `ChatInterviewController`. Questions never arrive via SSE until this is added.

**What T2-A needs to add to `src/server/routes/sessions.js` `/start` handler:**

```javascript
import { registerController } from '../routes/chat.js';
import { ChatInterviewController } from '../../assessment/chat-controller.js';
import { AnthropicLlmAdapter } from '../../assessment/anthropic-adapter.js';

// Inside POST /:id/start, after DB transition:
const adapter = new AnthropicLlmAdapter();
const ctrl = new ChatInterviewController({
  candidateId: sessionId,
  llmAdapter: adapter,
  sessionId,
});

// Wire questions → SSE broadcast
ctrl.on('question', ({ question, dimension }) => {
  // persist turn to DB (transcript_turns)
  // then notify SSE listeners:
  for (const send of entry?.listeners ?? []) {
    send({ event: 'interviewerTurn', data: { content: question, dimension } });
  }
});

ctrl.on('stateChange', ({ to }) => {
  if (to === 'completed') {
    // run extraction + scoring pipeline, store result, then:
    for (const send of entry?.listeners ?? []) { send({ event: 'end', data: { state: to } }); }
  }
});

registerController(sessionId, ctrl);
ctrl.begin();
ctrl.grantConsent(); // session already has consent recorded
```

**Also:** `POST /api/sessions/:id/respond` must call `ctrl.submitResponse(text)` on the registered controller (in addition to persisting the turn to DB).

---

## Dev Server Alternative

`src/web/dev-server.js` provides a **complete working backend** (no Postgres, no SSE) using a simpler long-poll API. Use for T2-B frontend development before T2-A's gap is closed:

```bash
node src/web/dev-server.js               # uses mock LLM questions
ANTHROPIC_API_KEY=... node src/web/dev-server.js  # real Claude Sonnet 4.6
```

Open `http://localhost:3000/?mode=dev` to use the dev server API.
Open `http://localhost:3000/?mode=mock` (or no param) for browser-only demo.
Open `http://localhost:3000/?mode=prod&userId=<uuid>` for T2-A production (needs gap closed + T2-C).

---

## Dev Server API (long-poll, no SSE)

`src/web/dev-server.js` implements the endpoints below at `http://localhost:3000`. All paths are relative to the server root. In production this will be `https://voloindex.org` (T2-A endpoints differ — see above).

---

## Endpoints

### 1. Create Session

**`POST /api/sessions`**

Creates a new assessment session and returns the session ID. No auth required for v1 (T2-C adds auth; when integrated, a valid session token or guest token must be provided via `Authorization: Bearer <token>`).

**Request body**
```json
{ "candidateName": "Jane Smith" }
```
| Field | Type | Required | Notes |
|---|---|---|---|
| `candidateName` | string | yes | Display name; max 100 chars |

**Response `201 Created`**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "state": "consent_pending"
}
```

---

### 2. Grant or Decline Consent

**`POST /api/sessions/:sessionId/consent`**

Records the candidate's D4 transcript-storage consent decision.

**Request body**
```json
{ "grant": true }
```
| Field | Type | Required | Notes |
|---|---|---|---|
| `grant` | boolean | yes | `true` = consent granted; `false` = declined |

**Response `200 OK` — consent granted (interview starts, first question returned)**
```json
{
  "state": "interviewing",
  "question": "Tell me about a time you designed a volunteer engagement program…",
  "dimension": "D1"
}
```

**Response `200 OK` — consent declined**
```json
{
  "state": "abandoned",
  "question": null,
  "dimension": null
}
```

> **Note:** T2-A must keep this request alive while the LLM generates the first question (up to ~30 seconds). The client waits.

---

### 3. Submit Interview Turn

**`POST /api/sessions/:sessionId/turn`**

Submits a candidate response to the current question. Returns the next question or signals completion.

**Request body**
```json
{ "response": "In my previous role I designed a structured 3-tier volunteer programme…" }
```
| Field | Type | Required | Notes |
|---|---|---|---|
| `response` | string | yes | Candidate's answer; 1–10 000 chars |

**Response `200 OK` — next question ready**
```json
{
  "state": "interviewing",
  "question": "What principles guide how you align volunteer programs with strategic goals?",
  "dimension": "D1"
}
```

**Response `200 OK` — interview complete, score ready**
```json
{
  "state": "completed",
  "question": null,
  "dimension": null,
  "score": {
    "overall": {
      "score": 6.2,
      "tier": "Proficient",
      "partial": false,
      "capped": false,
      "incomplete": false
    },
    "dimensions": [
      { "id": "D1", "name": "Strategic Engagement Design", "score": 6.5, "tier": "Proficient", "insufficientEvidence": false },
      { "id": "D2", "name": "Recruitment, Matching & Onboarding", "score": 5.9, "tier": "Proficient", "insufficientEvidence": false },
      { "id": "D3", "name": "Training, Development & Role Support", "score": 6.1, "tier": "Proficient", "insufficientEvidence": false },
      { "id": "D4", "name": "Performance, Impact & Accountability", "score": null, "tier": null, "insufficientEvidence": true },
      { "id": "D5", "name": "Recognition, Retention & Culture", "score": null, "tier": null, "insufficientEvidence": true },
      { "id": "D6", "name": "Ethics, Equity & Advocacy", "score": null, "tier": null, "insufficientEvidence": true }
    ],
    "rubricVersion": "1.2",
    "publicationStatus": "pending_review"
  }
}
```

**Response `200 OK` — interview abandoned (cost cap, candidate quit, error)**
```json
{
  "state": "abandoned",
  "question": null,
  "dimension": null,
  "score": null
}
```

> **Note:** T2-A must keep this request alive while the LLM generates the next question and runs the full extraction + scoring pipeline on completion. Set a 90-second server timeout for this endpoint.

---

### 4. Get Session State

**`GET /api/sessions/:sessionId`**

Returns the current session state. Used for reconnecting after a dropped connection.

**Response `200 OK`**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "state": "interviewing",
  "candidateName": "Jane Smith",
  "typing": false,
  "messages": [
    { "role": "interviewer", "content": "Tell me about…", "dimension": "D1", "turnIndex": 0 },
    { "role": "candidate",   "content": "In my role…",    "dimension": "D1", "turnIndex": 1 }
  ],
  "currentDimension": "D1"
}
```

State values: `consent_pending` | `interviewing` | `completed` | `abandoned` | `cost_capped`

---

## Error Responses

All errors return:
```json
{ "error": "<human-readable message>" }
```

| Status | Meaning |
|---|---|
| 400 | Bad request (missing/invalid field) |
| 404 | Session not found |
| 409 | Wrong state for action (e.g. submitting turn when `consent_pending`) |
| 500 | Server error |
| 504 | LLM timeout |

---

## Score Shape (T2-B display contract)

The `score` object in the completed `/turn` response is passed directly to the results dashboard. T2-B expects:

```typescript
interface Score {
  overall: {
    score: number | null;  // 1.0–10.0; null if incomplete
    tier: string | null;   // "Foundational" | "Developing" | "Proficient" | "Expert"
    partial: boolean;
    capped: boolean;
    incomplete: boolean;
  };
  dimensions: Array<{
    id: string;            // "D1"–"D6"
    name: string;
    score: number | null;  // null if insufficientEvidence
    tier: string | null;
    insufficientEvidence: boolean;
  }>;
  rubricVersion: string;
  publicationStatus: "pending_review" | "published";
}
```

T2-A constructs this by running `scoreAssessment()` from `src/scoring/index.js` and mapping the result.
See `src/web/dev-server.js` for the reference implementation of the extraction + scoring pipeline.

---

## Future Extensions (not in v1)

- **SSE stream** — `GET /api/sessions/:id/events` — real-time question delivery and typing indicator without long-polling
- **Resume** — reconnect to `GET /api/sessions/:id` after disconnect; T2-A must persist controller state in Postgres
- **Auth headers** — `Authorization: Bearer <token>` (T2-C); T2-B will pass the token on all requests once T2-C is integrated
- **Rate limiting** — 429 response; T2-B will show "too many requests" UI

---

## Dependency Spine

```
T2-A implements → /api/sessions endpoints
T2-B consumes  → /api/sessions endpoints
T2-C integrates → auth tokens on all requests
T2-D extends   → /api/sessions/:id/certificate (post-completion)
T2-E extends   → deep link + OG tags from credential page
```
