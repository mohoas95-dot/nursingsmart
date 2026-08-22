import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareExactRationalDescending,
  createExactRational,
  deserializeExactRational,
  exactRationalEquals,
  serializeExactRational,
} from '../../domain/math/exact-rational';

const integer = (value: string | number): bigint => BigInt(value);

test('equivalent halves normalize and compare exactly: 1/2 == 2/4 == 3/6', () => {
  const values = [
    createExactRational(integer(1), integer(2)),
    createExactRational(integer(2), integer(4)),
    createExactRational(integer(3), integer(6)),
  ];

  assert.deepEqual(values, [
    { numerator: integer(1), denominator: integer(2) },
    { numerator: integer(1), denominator: integer(2) },
    { numerator: integer(1), denominator: integer(2) },
  ]);
  assert.ok(exactRationalEquals(values[0], values[1]));
  assert.ok(exactRationalEquals(values[1], values[2]));
  assert.equal(compareExactRationalDescending(values[0], values[2]), 0);
});

test('thirds compare exactly: 1/3 == 2/6', () => {
  const oneThird = createExactRational(integer(1), integer(3));
  const twoSixths = createExactRational(integer(2), integer(6));

  assert.ok(exactRationalEquals(oneThird, twoSixths));
  assert.equal(compareExactRationalDescending(oneThird, twoSixths), 0);
});

test('descending comparison places 1/2 before 1/3', () => {
  const half = createExactRational(integer(1), integer(2));
  const third = createExactRational(integer(1), integer(3));

  assert.ok(compareExactRationalDescending(half, third) < 0);
  assert.ok(compareExactRationalDescending(third, half) > 0);
});

test('comparison cross-multiplies exactly beyond Number.MAX_SAFE_INTEGER', () => {
  const larger = createExactRational(
    integer('900719925474099312345678901234567890'),
    integer('900719925474099312345678901234567891')
  );
  const smaller = createExactRational(
    integer('900719925474099212345678901234567890'),
    integer('900719925474099212345678901234567891')
  );

  assert.ok(compareExactRationalDescending(larger, smaller) < 0);
  assert.ok(compareExactRationalDescending(smaller, larger) > 0);
  assert.equal(exactRationalEquals(larger, smaller), false);
});

test('every zero normalizes to 0/1', () => {
  assert.deepEqual(
    createExactRational(integer(0), integer('999999999999999999999999999999999999')),
    { numerator: integer(0), denominator: integer(1) }
  );
});

test('zero denominator is rejected', () => {
  assert.throws(
    () => createExactRational(integer(1), integer(0)),
    /denominator must not be zero/
  );
});

test('negative numerator and denominator values are rejected', () => {
  assert.throws(
    () => createExactRational(integer(-1), integer(2)),
    /numerator must be non-negative/
  );
  assert.throws(
    () => createExactRational(integer(1), integer(-2)),
    /denominator must be positive/
  );
});

test('decimal-string serialization round-trips without precision loss', () => {
  const original = createExactRational(
    integer('12345678901234567890123456789012345678901234567890'),
    integer('98765432109876543210987654321098765432109876543211')
  );

  const serialized = serializeExactRational(original);
  assert.match(serialized.numerator, /^\d+$/);
  assert.match(serialized.denominator, /^[1-9]\d*$/);

  const restored = deserializeExactRational(serialized);
  assert.deepEqual(restored, original);
  assert.deepEqual(serializeExactRational(restored), serialized);
});

test('construction, serialization, equality, and ordering are deterministic', () => {
  const inputs = [
    [integer(7), integer(9)],
    [integer(4), integer(5)],
    [integer(1), integer(3)],
    [integer(2), integer(6)],
  ] as const;

  const evaluate = () => inputs
    .map(([numerator, denominator]) => createExactRational(numerator, denominator))
    .sort(compareExactRationalDescending)
    .map(serializeExactRational);

  const expected = evaluate();
  for (let run = 0; run < 20; run += 1) {
    assert.deepEqual(evaluate(), expected);
  }
  assert.deepEqual(expected, [
    { numerator: '4', denominator: '5' },
    { numerator: '7', denominator: '9' },
    { numerator: '1', denominator: '3' },
    { numerator: '1', denominator: '3' },
  ]);
});
