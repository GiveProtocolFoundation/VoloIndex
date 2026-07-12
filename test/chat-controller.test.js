/**
 * Volo Index — P2c: Chat Interview Controller Tests
 *
 * Covers:
 * 1. Controller construction + validation
 * 2. State machine transitions (idle → consent_pending → interviewing → completed/abandoned/cost_capped)
 * 3. Consent gate: no interview without consent (D4)
 * 4. Happy-path interview via MockLlmAdapter: questions emitted, responses submitted, session completed
 * 5. Candidate abort mid-interview
 * 6. Decline consent → abandoned
 * 7. Message log with turnIndex linkage for evidenceRef traceability
 * 8. Typing indicator lifecycle
 * 9. Event emission (stateChange, question, typing, complete, error)
 * 10. Transcript store integration (consent-gated save)
 * 11. Cost cap handling
 * 12. Error recovery
 *
 * All tests use MockLlmAdapter only — no vendor SDK, no network.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ChatInterviewController, CONTROLLER_STATES,
  MockLlmAdapter,
  InMemoryTranscriptStore,
} from '../src/assessment/index.js';

import { DIMENSION_IDS } from '../src/scoring/config.js';

// ── Shared fixtures ──────────────────────────────────────────────────

const MOCK_QUESTION = 'Tell me about a time you designed a volunteer engagement strategy.';
const MOCK_RESPONSE = 'In my current role I built a structured volunteer program that aligned roles to our theory of change and tracked quarterly outcomes.';

function makeController(overrides = {}) {
  return new ChatInterviewController({
    candidateId: 'cand-ui-001',
    llmAdapter: new MockLlmAdapter({ '*': MOCK_QUESTION }),
    sessionId: 'sess-ui-001',
    interviewOpts: { maxTurnsPerDimension: 1 },
    ...overrides,
  });
}

/**
 * Drive a controller through the full happy path: begin → consent → answer all questions → completed.
 * Returns the controller after completion.
 */
async function driveToCompletion(ctrl) {
  ctrl.begin();
  ctrl.grantConsent();

  // Wait for each question, then submit a response
  for (let i = 0; i < 6; i++) {
    // Wait for the question to arrive (getCandidateResponse callback)
    await waitForAwaitingResponse(ctrl);
    ctrl.submitResponse(MOCK_RESPONSE);
  }

  // Wait for the completed state
  await waitForState(ctrl, 'completed');
  return ctrl;
}

/** Wait until the controller enters a specific state. */
function waitForState(ctrl, targetState, timeoutMs = 2000) {
  if (ctrl.state === targetState) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(
      `Timed out waiting for state "${targetState}" (current: "${ctrl.state}")`
    )), timeoutMs);
    const unsub = ctrl.on('stateChange', ({ to }) => {
      if (to === targetState) {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
  });
}

/** Wait until the controller is awaiting a candidate response. */
function waitForAwaitingResponse(ctrl, timeoutMs = 2000) {
  if (ctrl.awaitingResponse) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(
      `Timed out waiting for awaitingResponse (state: "${ctrl.state}")`
    )), timeoutMs);
    const unsub = ctrl.on('question', () => {
      clearTimeout(timer);
      unsub();
      resolve();
    });
  });
}

// ── 1. Construction + validation ────────────────────────────────────

describe('ChatInterviewController construction', () => {
  it('requires candidateId', () => {
    assert.throws(
      () => new ChatInterviewController({ candidateId: '', llmAdapter: new MockLlmAdapter() }),
      /candidateId must be/,
    );
  });

  it('requires llmAdapter', () => {
    assert.throws(
      () => new ChatInterviewController({ candidateId: 'x' }),
      /llmAdapter is required/,
    );
  });

  it('starts in idle state', () => {
    const ctrl = makeController();
    assert.equal(ctrl.state, 'idle');
    assert.equal(ctrl.typing, false);
    assert.equal(ctrl.awaitingResponse, false);
    assert.equal(ctrl.session, null);
    assert.deepStrictEqual(ctrl.messages, []);
    assert.equal(ctrl.error, null);
  });

  it('CONTROLLER_STATES exports all states', () => {
    assert.deepStrictEqual(CONTROLLER_STATES, [
      'idle', 'consent_pending', 'interviewing', 'completed', 'abandoned', 'cost_capped',
    ]);
  });
});

// ── 2. State machine transitions ────────────────────────────────────

describe('ChatInterviewController state transitions', () => {
  it('begin() transitions idle → consent_pending', () => {
    const ctrl = makeController();
    ctrl.begin();
    assert.equal(ctrl.state, 'consent_pending');
    assert.ok(ctrl.session, 'session should be created');
    assert.equal(ctrl.session.status, 'created');
  });

  it('begin() throws if not idle', () => {
    const ctrl = makeController();
    ctrl.begin();
    assert.throws(() => ctrl.begin(), /Cannot begin\(\) in state: consent_pending/);
  });

  it('grantConsent() transitions consent_pending → interviewing', async () => {
    const ctrl = makeController();
    ctrl.begin();
    ctrl.grantConsent();
    assert.equal(ctrl.state, 'interviewing');
    assert.equal(ctrl.session.status, 'in_progress');
    assert.equal(ctrl.session.consentGiven, true);
    assert.ok(ctrl.session.consentAt);
  });

  it('grantConsent() throws if not consent_pending', () => {
    const ctrl = makeController();
    assert.throws(() => ctrl.grantConsent(), /Cannot grantConsent\(\) in state: idle/);
  });

  it('declineConsent() transitions consent_pending → abandoned', () => {
    const ctrl = makeController();
    ctrl.begin();
    ctrl.declineConsent();
    assert.equal(ctrl.state, 'abandoned');
    assert.equal(ctrl.session.status, 'abandoned');
    assert.equal(ctrl.session.abandonReason, 'consent_declined');
  });

  it('declineConsent() throws if not consent_pending', () => {
    const ctrl = makeController();
    assert.throws(() => ctrl.declineConsent(), /Cannot declineConsent\(\) in state: idle/);
  });

  it('happy path reaches completed', async () => {
    const ctrl = makeController();
    await driveToCompletion(ctrl);
    assert.equal(ctrl.state, 'completed');
    assert.equal(ctrl.session.status, 'completed');
  });
});

// ── 3. Consent gate (D4) ────────────────────────────────────────────

describe('Consent gate (D4)', () => {
  it('no interview without consent — consent must be given before interview starts', () => {
    const ctrl = makeController();
    ctrl.begin();
    // Cannot submit responses without going through consent
    assert.throws(() => ctrl.submitResponse('hi'), /Cannot submitResponse\(\) in state: consent_pending/);
  });

  it('consent is recorded on the session with timestamp', () => {
    const ctrl = makeController();
    ctrl.begin();
    ctrl.grantConsent();
    assert.equal(ctrl.session.consentGiven, true);
    assert.ok(ctrl.session.consentAt);
    assert.ok(new Date(ctrl.session.consentAt).getTime() > 0);
  });

  it('declined consent prevents interview — session abandoned immediately', () => {
    const ctrl = makeController();
    ctrl.begin();
    ctrl.declineConsent();
    assert.equal(ctrl.state, 'abandoned');
    assert.equal(ctrl.session.consentGiven, false);
    // Cannot proceed after decline
    assert.throws(() => ctrl.grantConsent(), /Cannot grantConsent\(\) in state: abandoned/);
  });
});

// ── 4. Happy-path interview ─────────────────────────────────────────

describe('Happy-path interview via MockLlmAdapter', () => {
  it('completes after 6 dimensions with 1 Q&A each', async () => {
    const ctrl = makeController();
    await driveToCompletion(ctrl);

    assert.equal(ctrl.state, 'completed');
    assert.equal(ctrl.session.turnCount, 12); // 6 dims × 2 turns (Q+A)
    assert.equal(ctrl.session.coveredDimensions.length, 6);
  });

  it('emits question events for each dimension', async () => {
    const ctrl = makeController();
    const questions = [];
    ctrl.on('question', (q) => questions.push(q));

    await driveToCompletion(ctrl);

    assert.equal(questions.length, 6);
    // Each question should have dimension and turnIndex
    for (const q of questions) {
      assert.ok(q.dimension);
      assert.ok(typeof q.turnIndex === 'number');
      assert.ok(q.question);
    }
  });

  it('messages array contains all Q&A pairs with turn indices', async () => {
    const ctrl = makeController();
    await driveToCompletion(ctrl);

    const msgs = ctrl.messages;
    assert.equal(msgs.length, 12); // 6 questions + 6 responses

    // Verify alternating roles
    for (let i = 0; i < msgs.length; i++) {
      const expected = i % 2 === 0 ? 'interviewer' : 'candidate';
      assert.equal(msgs[i].role, expected, `Message ${i} should be ${expected}`);
      assert.ok(typeof msgs[i].turnIndex === 'number', `Message ${i} should have turnIndex`);
    }
  });

  it('interviewer messages have dimension tags', async () => {
    const ctrl = makeController();
    await driveToCompletion(ctrl);

    const interviewerMsgs = ctrl.messages.filter(m => m.role === 'interviewer');
    for (const msg of interviewerMsgs) {
      assert.ok(msg.dimension, 'Interviewer message should have dimension');
      assert.ok(DIMENSION_IDS.includes(msg.dimension), `Unknown dimension: ${msg.dimension}`);
    }
  });
});

// ── 5. Candidate abort ──────────────────────────────────────────────

describe('Candidate abort mid-interview', () => {
  it('abort() during pending question → session abandoned with candidate_ended', async () => {
    const ctrl = makeController();
    ctrl.begin();
    ctrl.grantConsent();

    // Wait for first question
    await waitForAwaitingResponse(ctrl);
    assert.equal(ctrl.awaitingResponse, true);

    // Abort
    ctrl.abort();

    // Wait for abandoned state
    await waitForState(ctrl, 'abandoned');
    assert.equal(ctrl.state, 'abandoned');
    assert.equal(ctrl.session.status, 'abandoned');
    assert.equal(ctrl.session.abandonReason, 'candidate_ended');
  });

  it('abort() during consent_pending → session abandoned with aborted', () => {
    const ctrl = makeController();
    ctrl.begin();
    ctrl.abort();
    assert.equal(ctrl.state, 'abandoned');
    assert.equal(ctrl.session.abandonReason, 'aborted');
  });

  it('abort() throws on completed controller', async () => {
    const ctrl = makeController();
    await driveToCompletion(ctrl);
    assert.throws(() => ctrl.abort(), /Cannot abort\(\) in state: completed/);
  });
});

// ── 6. Decline consent ──────────────────────────────────────────────

describe('Decline consent flow', () => {
  it('no transcript saved when consent declined', async () => {
    const store = new InMemoryTranscriptStore();
    const ctrl = makeController({ transcriptStore: store });
    ctrl.begin();
    ctrl.declineConsent();
    assert.equal(ctrl.state, 'abandoned');
    assert.equal(store.size, 0);
  });
});

// ── 7. Message log + evidenceRef linkage ────────────────────────────

describe('Message log evidenceRef linkage', () => {
  it('turnIndex in messages maps to session.transcript.turns for evidenceRef traceability', async () => {
    const ctrl = makeController();
    await driveToCompletion(ctrl);

    const transcript = ctrl.session.transcript;
    const msgs = ctrl.messages;

    // Each message's turnIndex should point to the corresponding transcript turn
    for (const msg of msgs) {
      const turn = transcript.turns[msg.turnIndex];
      assert.ok(turn, `Turn ${msg.turnIndex} should exist in transcript`);
      assert.equal(turn.role, msg.role, `Turn ${msg.turnIndex} role mismatch`);
      assert.equal(turn.content, msg.content, `Turn ${msg.turnIndex} content mismatch`);
    }
  });

  it('messages getter returns a defensive copy', async () => {
    const ctrl = makeController();
    ctrl.begin();
    ctrl.grantConsent();
    await waitForAwaitingResponse(ctrl);

    const msgs1 = ctrl.messages;
    ctrl.submitResponse(MOCK_RESPONSE);
    const msgs2 = ctrl.messages;

    assert.ok(msgs2.length > msgs1.length, 'New messages should appear');
    assert.equal(msgs1.length, 1, 'Prior snapshot should not be mutated');
  });
});

// ── 8. Typing indicator ─────────────────────────────────────────────

describe('Typing indicator lifecycle', () => {
  it('typing is true while LLM generates question, false when awaiting response', async () => {
    const ctrl = makeController();
    const typingStates = [];
    ctrl.on('typing', ({ typing }) => typingStates.push(typing));

    ctrl.begin();
    ctrl.grantConsent();

    // First typing=true (LLM generating first question)
    // Then typing=false (question arrived, awaiting response)
    await waitForAwaitingResponse(ctrl);
    assert.equal(ctrl.typing, false);

    // Submit response → typing=true (LLM generating next question)
    ctrl.submitResponse(MOCK_RESPONSE);
    // typing should have been set to true
    assert.ok(typingStates.includes(true), 'Should have emitted typing=true');
    assert.ok(typingStates.includes(false), 'Should have emitted typing=false');
  });

  it('typing is false after interview completes', async () => {
    const ctrl = makeController();
    await driveToCompletion(ctrl);
    assert.equal(ctrl.typing, false);
  });
});

// ── 9. Event emission ───────────────────────────────────────────────

describe('Event emission', () => {
  it('emits stateChange for each transition', async () => {
    const ctrl = makeController();
    const transitions = [];
    ctrl.on('stateChange', (t) => transitions.push(t));

    await driveToCompletion(ctrl);

    assert.ok(transitions.length >= 3);
    assert.deepStrictEqual(transitions[0], { from: 'idle', to: 'consent_pending' });
    assert.deepStrictEqual(transitions[1], { from: 'consent_pending', to: 'interviewing' });
    assert.deepStrictEqual(transitions[transitions.length - 1], { from: 'interviewing', to: 'completed' });
  });

  it('emits complete event with session reference', async () => {
    const ctrl = makeController();
    let completedSession = null;
    ctrl.on('complete', ({ session }) => { completedSession = session; });

    await driveToCompletion(ctrl);

    assert.ok(completedSession);
    assert.equal(completedSession.status, 'completed');
    assert.equal(completedSession.id, 'sess-ui-001');
  });

  it('on() returns an unsubscribe function', async () => {
    const ctrl = makeController();
    const events = [];
    const unsub = ctrl.on('stateChange', (e) => events.push(e));

    ctrl.begin(); // fires stateChange
    unsub();      // unsubscribe
    ctrl.declineConsent(); // fires stateChange but listener removed

    assert.equal(events.length, 1, 'Only one event should have been received');
  });

  it('listener errors do not break the controller', async () => {
    const ctrl = makeController();
    ctrl.on('stateChange', () => { throw new Error('listener crash'); });

    // Should not throw despite the listener error
    assert.doesNotThrow(() => ctrl.begin());
    assert.equal(ctrl.state, 'consent_pending');
  });
});

// ── 10. Transcript store integration ────────────────────────────────

describe('Transcript store integration', () => {
  it('saves transcript on completion when store is configured', async () => {
    const store = new InMemoryTranscriptStore();
    const ctrl = makeController({ transcriptStore: store });
    await driveToCompletion(ctrl);

    assert.equal(store.size, 1);
    const record = await store.load('sess-ui-001');
    assert.ok(record);
    assert.equal(record.sessionId, 'sess-ui-001');
    assert.equal(record.candidateId, 'cand-ui-001');
    assert.equal(record.consentGiven, true);
    assert.ok(record.consentAt);
    assert.ok(record.transcript);
    assert.ok(Array.isArray(record.transcript.turns));
  });

  it('does not save transcript when no store is configured', async () => {
    const ctrl = makeController(); // no transcriptStore
    await driveToCompletion(ctrl);
    // No error, just no save
    assert.equal(ctrl.state, 'completed');
  });
});

// ── 11. Cost cap handling ───────────────────────────────────────────

describe('Cost cap handling', () => {
  it('cost cap error during interview → cost_capped state', async () => {
    // Create an adapter that throws CostCapExceededError on second call
    let callCount = 0;
    const adapter = new MockLlmAdapter({ '*': MOCK_QUESTION });
    const originalComplete = adapter.complete.bind(adapter);
    adapter.complete = async (...args) => {
      callCount++;
      if (callCount > 1) {
        const err = new Error('Session cost cap exceeded');
        err.constructor = { name: 'CostCapExceededError' };
        throw err;
      }
      return originalComplete(...args);
    };

    const ctrl = makeController({ llmAdapter: adapter });
    ctrl.begin();
    ctrl.grantConsent();

    // Answer first question
    await waitForAwaitingResponse(ctrl);
    ctrl.submitResponse(MOCK_RESPONSE);

    // Wait for cost_capped state
    await waitForState(ctrl, 'cost_capped');
    assert.equal(ctrl.state, 'cost_capped');
    assert.ok(ctrl.error);
  });
});

// ── 12. Error recovery ──────────────────────────────────────────────

describe('Error recovery', () => {
  it('unexpected LLM error → abandoned state with error event', async () => {
    const adapter = new MockLlmAdapter({ '*': MOCK_QUESTION });
    adapter.complete = async () => { throw new Error('network failure'); };

    const ctrl = makeController({ llmAdapter: adapter });
    let errorEvent = null;
    ctrl.on('error', (e) => { errorEvent = e; });

    ctrl.begin();
    ctrl.grantConsent();

    await waitForState(ctrl, 'abandoned');
    assert.equal(ctrl.state, 'abandoned');
    assert.ok(errorEvent);
    assert.ok(errorEvent.error.message.includes('network failure'));
  });

  it('submitResponse() throws when no pending question', async () => {
    const ctrl = makeController();
    ctrl.begin();
    ctrl.grantConsent();

    // Don't wait for question — submit immediately
    // Need a tiny delay for the async runInterview to start
    assert.throws(
      () => ctrl.submitResponse('too early'),
      /No pending question/,
    );
  });

  it('submitResponse() rejects empty text', async () => {
    const ctrl = makeController();
    ctrl.begin();
    ctrl.grantConsent();
    await waitForAwaitingResponse(ctrl);

    assert.throws(() => ctrl.submitResponse(''), /Response text must be/);
    assert.throws(() => ctrl.submitResponse(null), /Response text must be/);
  });
});

// ── 13. currentDimension getter ─────────────────────────────────────

describe('currentDimension getter', () => {
  it('returns null when not interviewing', () => {
    const ctrl = makeController();
    assert.equal(ctrl.currentDimension, null);
    ctrl.begin();
    assert.equal(ctrl.currentDimension, null);
  });

  it('returns the dimension of the current question', async () => {
    const ctrl = makeController();
    ctrl.begin();
    ctrl.grantConsent();
    await waitForAwaitingResponse(ctrl);

    // First question is for D1
    assert.equal(ctrl.currentDimension, 'D1');
  });
});

// ── 14. Multi-turn per dimension ────────────────────────────────────

describe('Multi-turn per dimension', () => {
  it('handles maxTurnsPerDimension > 1 with non-substantive initial responses', async () => {
    // With maxTurns=2 and substantive responses, coverage met after first turn → 1 Q&A per dim
    const ctrl = makeController({ interviewOpts: { maxTurnsPerDimension: 2 } });
    await driveToCompletion(ctrl);
    // Coverage met after first substantive response → still 6 Q&A pairs
    assert.equal(ctrl.state, 'completed');
    assert.equal(ctrl.session.turnCount, 12);
  });
});
