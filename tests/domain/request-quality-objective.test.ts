import assert from 'node:assert/strict';
import test from 'node:test';

import { compareByObjective, type ScenarioObjectiveQuality } from '../../domain/scenarios/objective';
import type { ExactRational } from '../../domain/math/exact-rational';

function quality(
  essential: ExactRational,
  normal: ExactRational,
  lower: Partial<Omit<ScenarioObjectiveQuality, 'requestQuality'>> = {}
): ScenarioObjectiveQuality {
  return {
    requestQuality: {
      version: 'request-quality/1',
      essentialFulfillment: essential,
      normalFulfillment: normal,
      requestSatisfactionPercent: 50,
    },
    operationalEfficiencyScore: 50,
    fairnessScore: 50,
    warningDefectCount: 0,
    routineMismatchCount: 0,
    baselineSimilarityPercent: 50,
    ...lower,
  };
}

const one = { numerator: BigInt(1), denominator: BigInt(1) };
const zero = { numerator: BigInt(0), denominator: BigInt(1) };

test('Essential exact fulfillment outranks every Normal and lower-tier advantage', () => {
  const essentialWinner = quality(one, zero, {
    operationalEfficiencyScore: 0, fairnessScore: 0, warningDefectCount: 99,
    routineMismatchCount: 99, baselineSimilarityPercent: 0,
  });
  const lowerTierWinner = quality(zero, one, {
    operationalEfficiencyScore: 100, fairnessScore: 100, warningDefectCount: 0,
    routineMismatchCount: 0, baselineSimilarityPercent: 100,
  });
  assert.ok(compareByObjective(essentialWinner, lowerTierWinner) < 0);
});

test('Normal exact fulfillment decides only after Essential ties', () => {
  const betterNormal = quality(one, { numerator: BigInt(2), denominator: BigInt(3) }, {
    operationalEfficiencyScore: 0,
  });
  const betterProductivity = quality(one, { numerator: BigInt(1), denominator: BigInt(3) }, {
    operationalEfficiencyScore: 100,
  });
  assert.ok(compareByObjective(betterNormal, betterProductivity) < 0);
});

test('equivalent fractions tie and preserve the existing lower-tier order', () => {
  const productive = quality(
    { numerator: BigInt(1), denominator: BigInt(2) },
    { numerator: BigInt(1), denominator: BigInt(3) },
    { operationalEfficiencyScore: 90, fairnessScore: 0 }
  );
  const fair = quality(
    { numerator: BigInt(3), denominator: BigInt(6) },
    { numerator: BigInt(2), denominator: BigInt(6) },
    { operationalEfficiencyScore: 80, fairnessScore: 100 }
  );
  assert.ok(compareByObjective(productive, fair) < 0);
});

test('comparison remains exact beyond Number.MAX_SAFE_INTEGER', () => {
  const base = BigInt(Number.MAX_SAFE_INTEGER) * BigInt(10_000);
  const greater = quality({ numerator: base + BigInt(1), denominator: base + BigInt(2) }, zero);
  const lesser = quality({ numerator: base, denominator: base + BigInt(1) }, zero);
  assert.ok(compareByObjective(greater, lesser) < 0);
});
