#!/usr/bin/env node
/**
 * Volo Index Scoring Engine — QA Test Runner
 *
 * Usage:
 *   node tests/run-qa.js [--engine <path>] [--fixture <name>] [--verbose]
 *
 * --engine <path>   Path to the scoring engine module (default: ./src/scoring-engine.js)
 * --fixture <name>  Run only fixtures matching this name pattern
 * --verbose         Print full diff on failure
 *
 * The engine module must export a default function with signature:
 *   scoreAssessment(input: AssessmentInput): AssessmentOutput
 *
 * where AssessmentInput and AssessmentOutput match the §8 contract in docs/SCORING_RUBRIC.md.
 */

const fs = require("fs");
const path = require("path");

// ─── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const enginePath = args.includes("--engine")
  ? args[args.indexOf("--engine") + 1]
  : "./src/scoring-engine.js";
const fixtureFilter = args.includes("--fixture")
  ? args[args.indexOf("--fixture") + 1]
  : null;
const verbose = args.includes("--verbose");

// ─── Load engine ──────────────────────────────────────────────────────────────
let scoreAssessment;
try {
  const engine = require(path.resolve(enginePath));
  scoreAssessment = engine.default || engine.scoreAssessment || engine;
  if (typeof scoreAssessment !== "function") {
    throw new Error("Engine module must export a callable function.");
  }
} catch (err) {
  console.error(`❌ Cannot load engine from '${enginePath}': ${err.message}`);
  process.exit(1);
}

// ─── Load fixtures ────────────────────────────────────────────────────────────
const fixtureDir = path.join(__dirname, "fixtures");
const fixtureFiles = fs
  .readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => !fixtureFilter || f.includes(fixtureFilter))
  .sort();

if (fixtureFiles.length === 0) {
  console.error("No fixture files found.");
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function roundTo1(n) {
  return Math.round(n * 10) / 10;
}

function assert(condition, message, context) {
  if (!condition) {
    throw new AssertionError(message, context);
  }
}

class AssertionError extends Error {
  constructor(message, context) {
    super(message);
    this.name = "AssertionError";
    this.context = context;
  }
}

function deepGet(obj, ...keys) {
  return keys.reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

// ─── Per-case validators ──────────────────────────────────────────────────────

/**
 * Validate a dimension result against expected spec.
 */
function validateDimension(actual, expected, dimId) {
  if (expected.insufficientEvidence === true) {
    assert(
      actual.insufficientEvidence === true,
      `${dimId}: expected insufficientEvidence=true, got ${actual.insufficientEvidence}`,
      { actual }
    );
    assert(
      actual.score === null || actual.score === undefined,
      `${dimId}: IE dimension must have null/undefined score, got ${actual.score}`,
      { actual }
    );
    return;
  }

  if (expected.insufficientEvidence === false) {
    assert(
      !actual.insufficientEvidence,
      `${dimId}: expected insufficientEvidence=false, got ${actual.insufficientEvidence}`,
      { actual }
    );
  }

  // Score check (with 0.1 tolerance for floating-point)
  if (expected.score !== undefined && expected.score !== null) {
    const actualRounded = roundTo1(actual.score);
    assert(
      Math.abs(actualRounded - expected.score) <= 0.05,
      `${dimId}: expected score ${expected.score}, got ${actual.score} (rounded: ${actualRounded})`,
      { actual, expected }
    );
    // Verify 1 decimal rounding in output
    assert(
      String(actual.score).match(/^-?\d+(\.\d)?$/),
      `${dimId}: score must be rounded to 1 decimal place, got ${actual.score}`,
      { actual }
    );
  }

  if (expected.tier) {
    assert(
      actual.tier === expected.tier,
      `${dimId}: expected tier '${expected.tier}', got '${actual.tier}'`,
      { actual }
    );
  }

  if (expected.baseTier) {
    assert(
      actual.baseTier === expected.baseTier,
      `${dimId}: expected baseTier '${expected.baseTier}', got '${actual.baseTier}'`,
      { actual }
    );
  }

  // integrityFlags
  if (expected.integrityFlags) {
    for (const flag of expected.integrityFlags) {
      const hasFlag =
        (actual.integrityFlags || []).includes(flag) ||
        (actual.integrityFlags || []).some((f) =>
          typeof f === "object" ? f.rule === flag : f === flag
        );
      assert(
        hasFlag,
        `${dimId}: expected integrityFlag '${flag}' not found in ${JSON.stringify(actual.integrityFlags)}`,
        { actual }
      );
    }
  }

  // Red flags
  if (expected.redFlags) {
    assert(
      Array.isArray(actual.redFlags),
      `${dimId}: redFlags must be an array`,
      { actual }
    );
    if (expected.redFlags.length === 0) {
      assert(
        actual.redFlags.length === 0,
        `${dimId}: expected no redFlags, got ${JSON.stringify(actual.redFlags)}`,
        { actual }
      );
    }
    for (const expectedFlag of expected.redFlags) {
      const found = actual.redFlags.some(
        (rf) =>
          rf.anchor === expectedFlag.anchor ||
          (expectedFlag.capApplied !== undefined &&
            rf.capApplied === expectedFlag.capApplied)
      );
      assert(
        found,
        `${dimId}: expected redFlag with anchor '${expectedFlag.anchor}' not found`,
        { actual, expectedFlag }
      );
    }
  }
}

/**
 * Validate overall assessment output against expected spec.
 */
function validateOverall(actual, expected, fixtureName) {
  if (expected === null) {
    assert(
      actual.overall === null || actual.overall === undefined,
      `${fixtureName}: expected overall=null (≥2 IE dims), got ${JSON.stringify(actual.overall)}`,
      { actual }
    );
    return;
  }

  assert(actual.overall, `${fixtureName}: overall field must be present`, {
    actual,
  });

  if (expected.score !== undefined) {
    const actualRounded = roundTo1(actual.overall.score);
    assert(
      Math.abs(actualRounded - expected.score) <= 0.05,
      `${fixtureName}: overall expected score ${expected.score}, got ${actual.overall.score}`,
      { actual }
    );
  }

  if (expected.tier) {
    assert(
      actual.overall.tier === expected.tier,
      `${fixtureName}: overall expected tier '${expected.tier}', got '${actual.overall.tier}'`,
      { actual }
    );
  }

  if (expected.partial !== undefined) {
    assert(
      actual.overall.partial === expected.partial,
      `${fixtureName}: overall expected partial=${expected.partial}, got ${actual.overall.partial}`,
      { actual }
    );
  }

  if (expected.capped !== undefined) {
    assert(
      actual.overall.capped === expected.capped,
      `${fixtureName}: overall expected capped=${expected.capped}, got ${actual.overall.capped}`,
      { actual }
    );
  }
}

/**
 * Validate top-level output contract fields per §8.
 */
function validateContract(actual, fixtureName) {
  assert(
    actual.rubricVersion === "1.0",
    `${fixtureName}: rubricVersion must be '1.0' (string), got ${JSON.stringify(actual.rubricVersion)}`,
    { actual }
  );
  assert(
    Array.isArray(actual.dimensions),
    `${fixtureName}: dimensions must be array`,
    { actual }
  );
  assert(
    Array.isArray(actual.integrityFlags),
    `${fixtureName}: integrityFlags must be array (not null/absent)`,
    { actual }
  );
  assert(
    "overall" in actual,
    `${fixtureName}: 'overall' field must be present`,
    { actual }
  );

  // Check dimension ids are D1–D6
  const dimIds = actual.dimensions.map((d) => d.id);
  for (const id of ["D1", "D2", "D3", "D4", "D5", "D6"]) {
    if (dimIds.includes(id)) {
      const dim = actual.dimensions.find((d) => d.id === id);
      assert(
        "name" in dim,
        `${fixtureName}: dimension ${id} must have 'name' field`,
        { dim }
      );
      assert(
        "baseTier" in dim,
        `${fixtureName}: dimension ${id} must have 'baseTier' field`,
        { dim }
      );
      assert(
        "signals" in dim && Array.isArray(dim.signals),
        `${fixtureName}: dimension ${id} must have 'signals' array`,
        { dim }
      );
      assert(
        "redFlags" in dim && Array.isArray(dim.redFlags),
        `${fixtureName}: dimension ${id} must have 'redFlags' array`,
        { dim }
      );
      assert(
        "insufficientEvidence" in dim,
        `${fixtureName}: dimension ${id} must have 'insufficientEvidence' field`,
        { dim }
      );
    }
  }

  // Check integrityFlags names are valid strings from §7
  const validFlags = [
    "recall_inflation",
    "cross_dimension_contradiction",
    "generic_answer_detection",
    "uniform_maximum",
  ];
  for (const flag of actual.integrityFlags) {
    const flagName = typeof flag === "object" ? flag.rule : flag;
    assert(
      validFlags.includes(flagName),
      `${fixtureName}: integrityFlag '${flagName}' is not a valid §7 flag name. Valid: ${validFlags.join(", ")}`,
      { actual }
    );
  }
}

// ─── Main test loop ───────────────────────────────────────────────────────────
console.log(`\n🔬 Volo Index QA — Running ${fixtureFiles.length} fixture files\n`);
console.log(`   Engine: ${enginePath}`);
console.log(`   Fixtures: ${fixtureDir}\n`);
console.log("─".repeat(60));

for (const file of fixtureFiles) {
  const fixturePath = path.join(fixtureDir, file);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const fixtureName = file.replace(".json", "");

  // A fixture file may contain multiple named cases (case_A_*, case_B_*, etc.)
  // or a single top-level case with 'input' and 'expected'.
  const cases = [];

  if (fixture.input && fixture.expected) {
    cases.push({ name: fixtureName, ...fixture });
  }

  // Collect nested cases
  for (const [key, val] of Object.entries(fixture)) {
    if (key.startsWith("case_") && val && val.input) {
      cases.push({ name: `${fixtureName}/${key}`, ...val });
    }
  }

  if (cases.length === 0) {
    // Fixture with only nested cases (no top-level input)
    console.log(`  ⚠️  ${fixtureName}: no runnable cases found (meta/spec only)`);
    skipped++;
    continue;
  }

  for (const tc of cases) {
    const caseName = tc.name;

    // Skip cases marked as SKIP
    if (tc.expected && tc.expected._note && tc.expected._note.startsWith("SKIP")) {
      skipped++;
      console.log(`  ⏭️  ${caseName}: skipped (${tc.expected._note})`);
      continue;
    }

    try {
      // Call the engine
      let actual;
      if (tc.input.precomputedDimensions) {
        // Some fixtures test aggregation with pre-computed dimension scores.
        // These require the engine to expose an aggregation-only entry point.
        actual = scoreAssessment({ precomputedDimensions: tc.input.precomputedDimensions });
      } else {
        actual = scoreAssessment(tc.input);
      }

      // Contract check on every full-output case
      if (tc.expected && tc.expected.rubricVersion !== undefined) {
        validateContract(actual, caseName);
      }

      // Dimension checks
      if (tc.expected && tc.expected.dimensions) {
        for (const expectedDim of tc.expected.dimensions) {
          const actualDim = (actual.dimensions || []).find(
            (d) => d.id === expectedDim.id
          );
          assert(
            actualDim,
            `${caseName}: dimension ${expectedDim.id} not found in output`,
            { actual }
          );
          validateDimension(actualDim, expectedDim, `${caseName}/${expectedDim.id}`);
        }
      }

      // Overall checks
      if (tc.expected && "overall" in tc.expected) {
        validateOverall(actual, tc.expected.overall, caseName);
      }

      // Top-level integrityFlags check
      if (tc.expected && tc.expected.integrityFlags) {
        for (const flag of tc.expected.integrityFlags) {
          const hasFlag = (actual.integrityFlags || []).some((f) =>
            typeof f === "object" ? f.rule === flag : f === flag
          );
          assert(
            hasFlag,
            `${caseName}: top-level integrityFlag '${flag}' not found`,
            { actual }
          );
        }
      }

      // Verify flags that SHOULD NOT be present
      if (tc.expected && tc.expected._integrityFlags_should_NOT_contain) {
        const forbidden = tc.expected._integrityFlags_should_NOT_contain;
        const hasFlag = (actual.integrityFlags || []).some((f) =>
          typeof f === "object" ? f.rule === forbidden : f === forbidden
        );
        assert(
          !hasFlag,
          `${caseName}: integrityFlag '${forbidden}' should NOT be present but was found`,
          { actual }
        );
      }

      console.log(`  ✅  ${caseName}`);
      passed++;
    } catch (err) {
      console.log(`  ❌  ${caseName}: ${err.message}`);
      if (verbose && err.context) {
        console.log("      Context:", JSON.stringify(err.context, null, 2));
      }
      failed++;
      failures.push({ case: caseName, error: err.message, context: err.context });
    }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60));
console.log(
  `\n${passed + failed + skipped} total — ✅ ${passed} passed, ❌ ${failed} failed, ⏭️  ${skipped} skipped\n`
);

if (failed > 0) {
  console.log("FAILURES:");
  for (const f of failures) {
    console.log(`  • ${f.case}: ${f.error}`);
  }
  console.log();
  process.exit(1);
} else {
  console.log("All tests passed.\n");
  process.exit(0);
}
