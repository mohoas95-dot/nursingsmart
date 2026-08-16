/**
 * Phase 5 — Blocker regression tests
 * ==================================
 *
 * Blocker 1: `ScenarioWorkspace` ranked scenarios with its own similarity-first
 *            sort, creating a second ranking authority that could invert the
 *            engine's order in front of the user.
 *
 * Blocker 2: `compareByObjective` used pairwise epsilon equality
 *            (`|a − b| < 0.5`), which is not transitive, so the final ordering
 *            depended on the input permutation.
 *
 * These tests assert the corrected behavioural contracts, not implementation shape.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareByObjective,
  materialBucket,
  isMateriallyEqual,
  OBJECTIVE_MATERIAL_DIFFERENCE,
  type ScenarioObjective,
  type ScenarioObjectiveQuality,
} from '../../domain/scenarios/objective';
import {
  buildObjectiveRankMap,
  orderScenariosByObjective,
} from '../../domain/scenarios/scenario-quality';
import { generateAndScoreScenarios } from '../../lib/scenarioGenerator';
import { solveNursingSchedule } from '../../lib/solver';
import { CAL_MONTH, CAL_YEAR, makePerson, makeSettings } from '../fixtures/realistic';

function quality(overrides: Partial<ScenarioObjectiveQuality>): ScenarioObjectiveQuality {
  return {
    requestSatisfactionPercent: 80,
    operationalEfficiencyScore: 80,
    fairnessScore: 80,
    warningDefectCount: 0,
    routineMismatchCount: 0,
    baselineSimilarityPercent: 80,
    ...overrides,
  };
}

function objective(overrides: Partial<ScenarioObjectiveQuality>): ScenarioObjective {
  return {
    version: 'scenario-objective/2',
    gates: {
      criticalResolved: true,
      criticalWarningCount: 0,
      locksPreserved: true,
      withinMaxBaselineDifference: true,
      meetsMinBaselineDifference: true,
    },
    quality: quality(overrides),
  };
}

/** All permutations of an array (n is tiny in these tests). */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += 1) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) output.push([items[index], ...tail]);
  }
  return output;
}

// ===========================================================================
// Blocker 2 — transitivity & permutation invariance
// ===========================================================================

// The exact adversarial case from the review: pairwise-epsilon equality made
// 90.0 ≈ 90.4 and 90.4 ≈ 90.8 while 90.0 ≉ 90.8, so similarity (the LAST tier)
// decided two of the three pairs and produced a cycle.
const ADVERSARIAL = {
  a: quality({ fairnessScore: 90.0, baselineSimilarityPercent: 99 }),
  b: quality({ fairnessScore: 90.4, baselineSimilarityPercent: 50 }),
  c: quality({ fairnessScore: 90.8, baselineSimilarityPercent: 10 }),
};

test('blocker-2: the adversarial 90.0 / 90.4 / 90.8 case cannot produce a comparison cycle', () => {
  const { a, b, c } = ADVERSARIAL;
  const ab = Math.sign(compareByObjective(a, b));
  const bc = Math.sign(compareByObjective(b, c));
  const ac = Math.sign(compareByObjective(a, c));

  // The historical failure was exactly: a > b, b > c, but c > a.
  assert.equal(
    ab <= 0 && bc <= 0 && ac > 0,
    false,
    'comparator must not report A>B, B>C and C>A'
  );

  // And the corrected bucket semantics: 90.0→180, 90.4→181, 90.8→182, so
  // fairness (a higher tier) strictly decides all three pairs and similarity
  // never gets a say.
  assert.ok(compareByObjective(c, b) < 0, 'fairness 90.8 outranks 90.4');
  assert.ok(compareByObjective(b, a) < 0, 'fairness 90.4 outranks 90.0');
  assert.ok(compareByObjective(c, a) < 0, 'fairness 90.8 outranks 90.0');
});

test('blocker-2: sorting the adversarial candidates is permutation invariant', () => {
  const { a, b, c } = ADVERSARIAL;
  const results = permutations([a, b, c]).map(candidates =>
    [...candidates].sort(compareByObjective).map(item => item.fairnessScore).join('>')
  );

  assert.equal(new Set(results).size, 1, `all permutations must sort identically, got ${JSON.stringify(results)}`);
  // Highest fairness first; similarity (99 / 50 / 10) is deliberately inverted
  // to prove the last tier did not drive the order.
  assert.deepEqual(
    [...[a, b, c]].sort(compareByObjective).map(item => item.baselineSimilarityPercent),
    [10, 50, 99]
  );
});

test('blocker-2: the comparator is transitive across a dense grid straddling bucket edges', () => {
  const fairnessValues = [89.6, 89.74, 89.75, 89.9, 90.0, 90.24, 90.25, 90.4, 90.7, 90.8, 91.3];
  const candidates = fairnessValues.flatMap((fairnessScore, index) => [
    quality({ fairnessScore, baselineSimilarityPercent: 100 - index }),
    quality({ fairnessScore, baselineSimilarityPercent: 40 - index }),
  ]);

  let orderingViolations = 0;
  let equalityViolations = 0;
  for (const left of candidates) {
    for (const middle of candidates) {
      for (const right of candidates) {
        const lm = Math.sign(compareByObjective(left, middle));
        const mr = Math.sign(compareByObjective(middle, right));
        const lr = Math.sign(compareByObjective(left, right));
        // left ≤ middle ≤ right ⇒ left ≤ right
        if (lm <= 0 && mr <= 0 && lr > 0) orderingViolations += 1;
        // equality must be an equivalence relation
        if (lm === 0 && mr === 0 && lr !== 0) equalityViolations += 1;
      }
    }
  }
  assert.equal(orderingViolations, 0, 'comparator ordering must be transitive');
  assert.equal(equalityViolations, 0, 'comparator equality must be transitive');
});

test('blocker-2: the 0.5 material tolerance is preserved, not removed', () => {
  assert.equal(OBJECTIVE_MATERIAL_DIFFERENCE, 0.5, 'tolerance threshold is unchanged');

  // Values inside the same bucket stay tied on that tier, so a LOWER tier decides.
  const tiedFairnessLowerSimilarity = quality({ fairnessScore: 90.0, baselineSimilarityPercent: 70 });
  const tiedFairnessHigherSimilarity = quality({ fairnessScore: 90.1, baselineSimilarityPercent: 95 });
  assert.equal(materialBucket(90.0), materialBucket(90.1));
  assert.ok(isMateriallyEqual(90.0, 90.1));
  assert.ok(
    compareByObjective(tiedFairnessHigherSimilarity, tiedFairnessLowerSimilarity) < 0,
    'within one bucket the later tier (similarity) still decides'
  );

  // Rounding noise from toFixed(2) must never outrank a real lower-tier gain.
  assert.ok(compareByObjective(
    quality({ fairnessScore: 90.0, warningDefectCount: 0 }),
    quality({ fairnessScore: 90.1, warningDefectCount: 4 })
  ) < 0);
});

test('blocker-2: equality by bucket is a genuine equivalence relation', () => {
  // Pairwise epsilon failed exactly here: 90.0 ≈ 90.4 ≈ 90.8 but 90.0 ≉ 90.8.
  assert.equal(isMateriallyEqual(90.0, 90.4), false);
  assert.equal(isMateriallyEqual(90.4, 90.8), false);
  assert.equal(isMateriallyEqual(90.0, 90.8), false);

  // Reflexive, symmetric, transitive on same-bucket values.
  assert.ok(isMateriallyEqual(90.0, 90.0));
  assert.equal(isMateriallyEqual(90.0, 90.2), isMateriallyEqual(90.2, 90.0));
  assert.ok(isMateriallyEqual(89.9, 90.0) && isMateriallyEqual(90.0, 90.1) && isMateriallyEqual(89.9, 90.1));
});

test('blocker-2: tier order is unchanged by the bucketing fix', () => {
  // requests > productivity > fairness > defects > routine > similarity
  assert.ok(compareByObjective(
    quality({ requestSatisfactionPercent: 90, operationalEfficiencyScore: 10, fairnessScore: 10, warningDefectCount: 9, baselineSimilarityPercent: 10 }),
    quality({ requestSatisfactionPercent: 80, operationalEfficiencyScore: 99, fairnessScore: 99, warningDefectCount: 0, baselineSimilarityPercent: 99 })
  ) < 0);
  assert.ok(compareByObjective(
    quality({ operationalEfficiencyScore: 90, fairnessScore: 10, baselineSimilarityPercent: 10 }),
    quality({ operationalEfficiencyScore: 80, fairnessScore: 99, baselineSimilarityPercent: 99 })
  ) < 0);
  assert.ok(compareByObjective(
    quality({ fairnessScore: 90, warningDefectCount: 3, baselineSimilarityPercent: 10 }),
    quality({ fairnessScore: 80, warningDefectCount: 0, baselineSimilarityPercent: 99 })
  ) < 0);
  assert.ok(compareByObjective(
    quality({ warningDefectCount: 1, baselineSimilarityPercent: 10 }),
    quality({ warningDefectCount: 2, baselineSimilarityPercent: 99 })
  ) < 0);
  assert.ok(compareByObjective(
    quality({ routineMismatchCount: 0, baselineSimilarityPercent: 10 }),
    quality({ routineMismatchCount: 3, baselineSimilarityPercent: 99 })
  ) < 0);
  assert.ok(compareByObjective(
    quality({ baselineSimilarityPercent: 95 }),
    quality({ baselineSimilarityPercent: 80 })
  ) < 0);
});

// ===========================================================================
// Blocker 1 — the UI rank must equal the canonical engine order
// ===========================================================================

test('blocker-1: displayed rank follows the canonical objective, not baseline similarity', () => {
  // This is the exact inversion observed end-to-end before the fix:
  // engine rank 1 had LOWER similarity but better fairness, while the UI's
  // similarity-first sort showed it as rank 3.
  const engineOrder = [
    { id: 1, objective: objective({ fairnessScore: 56.51, baselineSimilarityPercent: 87.10 }) },
    { id: 2, objective: objective({ fairnessScore: 52.26, baselineSimilarityPercent: 90.32 }) },
    { id: 3, objective: objective({ fairnessScore: 40.91, baselineSimilarityPercent: 85.48 }) },
  ];

  const rankByKey = buildObjectiveRankMap(engineOrder, scenario => String(scenario.id));
  assert.equal(rankByKey.get('1'), 1);
  assert.equal(rankByKey.get('2'), 2);
  assert.equal(rankByKey.get('3'), 3);

  // Prove the old authority really would have disagreed.
  const similarityFirst = [...engineOrder]
    .sort((left, right) =>
      right.objective.quality.baselineSimilarityPercent - left.objective.quality.baselineSimilarityPercent)
    .map(scenario => scenario.id);
  assert.deepEqual(similarityFirst, [2, 1, 3], 'similarity-first ordering differs — the test is meaningful');
  assert.notDeepEqual(
    orderScenariosByObjective(engineOrder).map(scenario => scenario.id),
    similarityFirst,
    'canonical rank must not equal the similarity-first rank'
  );
});

test('blocker-1: UI ordering is independent of the order scenarios are handed to it', () => {
  const scenarios = [
    { id: 1, objective: objective({ fairnessScore: 56.51, baselineSimilarityPercent: 87.10 }) },
    { id: 2, objective: objective({ fairnessScore: 52.26, baselineSimilarityPercent: 90.32 }) },
    { id: 3, objective: objective({ fairnessScore: 40.91, baselineSimilarityPercent: 85.48 }) },
  ];
  for (const permutation of permutations(scenarios)) {
    assert.deepEqual(
      orderScenariosByObjective(permutation).map(scenario => scenario.id),
      [1, 2, 3]
    );
  }
});

test('blocker-1: legacy scenarios without an objective keep their persisted order', () => {
  // No objective is fabricated and missing quality is NOT treated as zero:
  // the stored order (which was the selection order when they were generated)
  // is preserved verbatim.
  const legacy = [{ id: 7 }, { id: 8 }, { id: 9 }] as Array<{ id: number; objective?: ScenarioObjective }>;
  assert.deepEqual(orderScenariosByObjective(legacy).map(scenario => scenario.id), [7, 8, 9]);

  const rankByKey = buildObjectiveRankMap(legacy, scenario => String(scenario.id));
  assert.equal(rankByKey.get('7'), 1);
  assert.equal(rankByKey.get('9'), 3);

  // A mixed list (one legacy member) is also left untouched: comparing
  // scenarios scored under different objective versions is meaningless.
  const mixed = [
    { id: 1, objective: objective({ fairnessScore: 10, baselineSimilarityPercent: 10 }) },
    { id: 2 },
    { id: 3, objective: objective({ fairnessScore: 99, baselineSimilarityPercent: 99 }) },
  ] as Array<{ id: number; objective?: ScenarioObjective }>;
  assert.deepEqual(orderScenariosByObjective(mixed).map(scenario => scenario.id), [1, 2, 3]);
});

test('blocker-1: ordering is stable for fully tied scenarios', () => {
  const tied = [
    { id: 1, objective: objective({}) },
    { id: 2, objective: objective({}) },
    { id: 3, objective: objective({}) },
  ];
  assert.deepEqual(orderScenariosByObjective(tied).map(scenario => scenario.id), [1, 2, 3]);
});

// ===========================================================================
// Blocker 1 — end-to-end: real generator output, real UI ranking helper
// ===========================================================================

test('blocker-1 (end-to-end): UI rank order equals the canonical engine top3 order', () => {
  // A real generator configuration in which similarity-first ordering and the
  // canonical objective genuinely disagree, so the assertion cannot pass by
  // coincidence.
  const personnel = [
    makePerson('s0', { orderIndex: 0, employmentType: 'official' }),
    makePerson('s1', { orderIndex: 1, employmentType: 'contract' }),
    makePerson('s2', { orderIndex: 2, employmentType: 'conscript' }),
    makePerson('s3', { orderIndex: 3, employmentType: 'official' }),
  ];
  const settings = makeSettings({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 });
  const baseline = solveNursingSchedule(CAL_YEAR, CAL_MONTH, personnel, [], settings, {}, undefined, null);
  const generated = generateAndScoreScenarios(
    CAL_YEAR, CAL_MONTH, personnel, [], settings, {}, undefined, null,
    'nurse', baseline.assignments as any, []
  );

  assert.ok(generated.top3.length >= 2, 'fixture must produce comparable scenarios');

  // The engine's own selection order, as persisted and displayed.
  const engineOrder = generated.top3.map(scenario => scenario.id);

  // What the removed UI sort would have shown.
  const similarityFirstOrder = [...generated.top3]
    .sort((left, right) =>
      (right.baselineSimilarityPercent ?? 0) - (left.baselineSimilarityPercent ?? 0))
    .map(scenario => scenario.id);

  assert.notDeepEqual(
    similarityFirstOrder,
    engineOrder,
    'fixture must be one where similarity-first disagrees with the engine'
  );

  // The UI ranking helper must reproduce the engine order exactly.
  const rankByKey = buildObjectiveRankMap(generated.top3, scenario => String(scenario.id));
  const uiOrder = [...generated.top3]
    .sort((left, right) => rankByKey.get(String(left.id))! - rankByKey.get(String(right.id))!)
    .map(scenario => scenario.id);

  assert.deepEqual(uiOrder, engineOrder, 'displayed rank order must equal the canonical engine order');
  generated.top3.forEach((scenario, index) => {
    assert.equal(rankByKey.get(String(scenario.id)), index + 1);
  });
});
