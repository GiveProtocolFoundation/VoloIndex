/**
 * Volo Index — Practice Mode Configuration (T2-F)
 *
 * Constants governing the "play" practice interview experience.
 * Practice mode gives candidates a single-dimension unscored demo
 * so they can experience the interview format before committing
 * to a full assessed session.
 *
 * Key differences from a real assessment:
 *   - Single dimension only (D1 by default)
 *   - Tighter LLM cost cap ($0.25 vs $2.00)
 *   - No scoring, no signal extraction, no certificate
 *   - Ephemeral sessions — no transcript persistence
 *   - No consent gate (nothing is retained)
 *   - Qualitative-only feedback at completion
 */

import { DIMENSIONS } from '../scoring/config.js';

/** Practice mode interviews cover exactly one dimension. */
export const PRACTICE_DIMENSION_COUNT = 1;

/**
 * Default dimension for practice mode.
 * D1 (Strategic Engagement Design) is the broadest and most accessible
 * for candidates unfamiliar with the rubric structure.
 */
export const PRACTICE_DEFAULT_DIMENSION = 'D1';

/** Practice mode uses only the selected dimension. */
export function practiceDimensionOrder(dimId = PRACTICE_DEFAULT_DIMENSION) {
  const dim = DIMENSIONS.find(d => d.id === dimId);
  if (!dim) throw new Error(`Unknown dimension: ${dimId}`);
  return [dimId];
}

/**
 * LLM cost cap for practice sessions.
 * Tighter than the full assessment ($2.00) — practice covers one dimension
 * with at most 2 candidate turns, so $0.25 is generous.
 */
export const PRACTICE_HARD_CAP = 0.25;

/** Warning threshold for practice sessions. */
export const PRACTICE_TARGET_SPEND = 0.10;

/** Maximum candidate turns per dimension in practice (same as production). */
export const PRACTICE_MAX_TURNS_PER_DIM = 2;

/**
 * Practice sessions are ephemeral — no transcript store, no consent gate.
 * This flag is checked by session-creation logic to skip persistence.
 */
export const PRACTICE_EPHEMERAL = true;

/**
 * Practice mode does not produce scored results.
 * The frontend shows qualitative feedback only.
 */
export const PRACTICE_SCORED = false;

/**
 * Qualitative feedback templates by dimension.
 * Displayed after the practice interview instead of numerical scores.
 * Each entry provides conversational guidance about what the real
 * assessment evaluates, without leaking rubric signal codes.
 */
export const PRACTICE_FEEDBACK = {
  D1: {
    dimension: 'Strategic Engagement Design',
    strong: 'Your response demonstrated clear strategic thinking about volunteer engagement. In the full assessment, we look for specific examples of how you align volunteer programs with organisational goals, design engagement pathways, and measure strategic outcomes.',
    developing: 'You touched on some strategic concepts. To strengthen your responses in the full assessment, try sharing specific examples of how you\'ve designed or improved volunteer programs — what was the situation, what did you do, and what impact did it have?',
    needsWork: 'The practice gave you a taste of the interview format. In the full assessment, interviewers will probe your real-world experience designing volunteer engagement strategies. Think about specific programs you\'ve led or contributed to, and the strategic decisions behind them.',
  },
  D2: {
    dimension: 'Recruitment, Matching & Onboarding',
    strong: 'Your examples showed thoughtful approaches to volunteer recruitment and matching. The full assessment evaluates how you identify talent, match volunteers to appropriate roles, and structure onboarding for success.',
    developing: 'You shared some relevant experience. To prepare for the full assessment, reflect on specific recruitment campaigns, how you matched volunteers to roles, and what made your onboarding processes effective.',
    needsWork: 'The interview explores how you recruit, select, and onboard volunteers. Think about real examples of recruitment strategies, role-matching decisions, and onboarding programs you\'ve designed or managed.',
  },
  D3: {
    dimension: 'Training, Development & Role Support',
    strong: 'Your responses reflected strong training and development practices. The full assessment evaluates how you identify learning needs, design training programs, and provide ongoing role support to volunteers.',
    developing: 'You showed awareness of training needs. To strengthen your full assessment, prepare examples of training programs you\'ve designed, how you identified learning gaps, and how you supported volunteers through challenges.',
    needsWork: 'This dimension explores your approach to volunteer training and support. Prepare specific examples of training programs, development opportunities, and how you\'ve helped volunteers grow in their roles.',
  },
};
