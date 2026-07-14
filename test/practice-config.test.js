/**
 * Tests for Practice Mode Configuration (T2-F)
 *
 * Validates that practice-config.js exports are internally consistent
 * and aligned with the practice mode specification:
 *   - Single dimension, tighter cost cap, ephemeral, no scoring
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRACTICE_DIMENSION_COUNT,
  PRACTICE_DEFAULT_DIMENSION,
  practiceDimensionOrder,
  PRACTICE_HARD_CAP,
  PRACTICE_TARGET_SPEND,
  PRACTICE_MAX_TURNS_PER_DIM,
  PRACTICE_EPHEMERAL,
  PRACTICE_SCORED,
  PRACTICE_FEEDBACK,
} from '../src/assessment/practice-config.js';

import { DIMENSIONS, DIMENSION_IDS } from '../src/scoring/config.js';
import { DEFAULT_MAX_TURNS_PER_DIM } from '../src/assessment/interviewer.js';

// ── Dimension constraints ──────────────────────────────────────────────────

describe('practice-config: dimension constraints', () => {
  it('covers exactly one dimension', () => {
    assert.equal(PRACTICE_DIMENSION_COUNT, 1);
  });

  it('default dimension is D1', () => {
    assert.equal(PRACTICE_DEFAULT_DIMENSION, 'D1');
  });

  it('default dimension exists in scoring config', () => {
    assert.ok(DIMENSION_IDS.includes(PRACTICE_DEFAULT_DIMENSION));
  });

  it('practiceDimensionOrder returns single-element array for valid dim', () => {
    for (const dimId of DIMENSION_IDS) {
      const order = practiceDimensionOrder(dimId);
      assert.equal(order.length, 1, `Expected 1 for ${dimId}`);
      assert.equal(order[0], dimId);
    }
  });

  it('practiceDimensionOrder defaults to D1', () => {
    const order = practiceDimensionOrder();
    assert.deepEqual(order, ['D1']);
  });

  it('practiceDimensionOrder throws on unknown dimension', () => {
    assert.throws(() => practiceDimensionOrder('D99'), /Unknown dimension/);
  });
});

// ── Cost cap constraints ───────────────────────────────────────────────────

describe('practice-config: cost caps', () => {
  it('hard cap is $0.25', () => {
    assert.equal(PRACTICE_HARD_CAP, 0.25);
  });

  it('target spend is $0.10', () => {
    assert.equal(PRACTICE_TARGET_SPEND, 0.10);
  });

  it('hard cap is tighter than production ($2.00)', () => {
    assert.ok(PRACTICE_HARD_CAP < 2.00,
      `Practice hard cap $${PRACTICE_HARD_CAP} should be < production $2.00`);
  });

  it('target spend is below hard cap', () => {
    assert.ok(PRACTICE_TARGET_SPEND < PRACTICE_HARD_CAP,
      'Target spend should be below hard cap');
  });
});

// ── Session behavior flags ─────────────────────────────────────────────────

describe('practice-config: session behavior', () => {
  it('sessions are ephemeral (no persistence)', () => {
    assert.equal(PRACTICE_EPHEMERAL, true);
  });

  it('sessions are not scored', () => {
    assert.equal(PRACTICE_SCORED, false);
  });

  it('max turns per dim matches production default', () => {
    assert.equal(PRACTICE_MAX_TURNS_PER_DIM, DEFAULT_MAX_TURNS_PER_DIM,
      'Practice mode should use the same turn budget as production');
  });
});

// ── Qualitative feedback ───────────────────────────────────────────────────

describe('practice-config: qualitative feedback templates', () => {
  it('provides feedback for D1–D3', () => {
    for (const dimId of ['D1', 'D2', 'D3']) {
      assert.ok(PRACTICE_FEEDBACK[dimId], `Missing feedback for ${dimId}`);
    }
  });

  it('each feedback entry has dimension, strong, developing, needsWork', () => {
    for (const [dimId, fb] of Object.entries(PRACTICE_FEEDBACK)) {
      assert.ok(typeof fb.dimension === 'string' && fb.dimension.length > 0,
        `${dimId}.dimension should be a non-empty string`);
      assert.ok(typeof fb.strong === 'string' && fb.strong.length > 0,
        `${dimId}.strong should be a non-empty string`);
      assert.ok(typeof fb.developing === 'string' && fb.developing.length > 0,
        `${dimId}.developing should be a non-empty string`);
      assert.ok(typeof fb.needsWork === 'string' && fb.needsWork.length > 0,
        `${dimId}.needsWork should be a non-empty string`);
    }
  });

  it('feedback does not leak rubric signal codes', () => {
    const RUBRIC_CODES = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
    for (const [dimId, fb] of Object.entries(PRACTICE_FEEDBACK)) {
      for (const level of ['strong', 'developing', 'needsWork']) {
        for (const code of RUBRIC_CODES) {
          assert.ok(!fb[level].includes(code),
            `${dimId}.${level} must not contain rubric code "${code}"`);
        }
      }
    }
  });

  it('feedback dimension names match scoring config', () => {
    for (const [dimId, fb] of Object.entries(PRACTICE_FEEDBACK)) {
      const dim = DIMENSIONS.find(d => d.id === dimId);
      assert.ok(dim, `${dimId} should exist in DIMENSIONS`);
      assert.equal(fb.dimension, dim.name,
        `Feedback dimension name for ${dimId} should match scoring config`);
    }
  });
});
