/**
 * Exact, non-negative rational arithmetic for authoritative domain comparisons.
 *
 * Rationals are normalized at construction time and are never converted to
 * floating point for equality or ordering. The serialized form uses decimal
 * strings because JSON cannot safely represent bigint values.
 *
 * PURE: no I/O and no mutable module state.
 */

const ZERO = BigInt(0);
const ONE = BigInt(1);
const UNSIGNED_DECIMAL = /^(0|[1-9]\d*)$/;

/** A normalized, non-negative rational value. */
export interface ExactRational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** JSON-safe representation of an exact rational. */
export interface SerializedExactRational {
  readonly numerator: string;
  readonly denominator: string;
}

function assertBigInt(value: bigint, field: 'numerator' | 'denominator'): void {
  if (typeof value !== 'bigint') {
    throw new TypeError(`ExactRational ${field} must be a bigint`);
  }
}

function assertValidParts(numerator: bigint, denominator: bigint): void {
  assertBigInt(numerator, 'numerator');
  assertBigInt(denominator, 'denominator');

  if (numerator < ZERO) {
    throw new RangeError('ExactRational numerator must be non-negative');
  }
  if (denominator === ZERO) {
    throw new RangeError('ExactRational denominator must not be zero');
  }
  if (denominator < ZERO) {
    throw new RangeError('ExactRational denominator must be positive');
  }
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== ZERO) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

/**
 * Construct and normalize an exact rational.
 *
 * The denominator is always positive, and every zero is represented as 0/1.
 */
export function createExactRational(
  numerator: bigint,
  denominator: bigint = ONE
): ExactRational {
  assertValidParts(numerator, denominator);

  if (numerator === ZERO) {
    return { numerator: ZERO, denominator: ONE };
  }

  const divisor = greatestCommonDivisor(numerator, denominator);
  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor,
  };
}

/** Canonical zero and one values for fixed request credits. */
export const EXACT_RATIONAL_ZERO: ExactRational = createExactRational(ZERO, ONE);
export const EXACT_RATIONAL_ONE: ExactRational = createExactRational(ONE, ONE);

/**
 * Exact equality by cross multiplication. No Number conversion is performed.
 */
export function exactRationalEquals(
  left: Readonly<ExactRational>,
  right: Readonly<ExactRational>
): boolean {
  assertValidParts(left.numerator, left.denominator);
  assertValidParts(right.numerator, right.denominator);
  return left.numerator * right.denominator === right.numerator * left.denominator;
}

/**
 * Descending exact comparison suitable for Array.prototype.sort.
 *
 * A negative result means `left` is greater (and therefore sorts first), a
 * positive result means `right` is greater, and zero means exact equality.
 * Comparison uses bigint cross multiplication only.
 */
export function compareExactRationalDescending(
  left: Readonly<ExactRational>,
  right: Readonly<ExactRational>
): number {
  assertValidParts(left.numerator, left.denominator);
  assertValidParts(right.numerator, right.denominator);

  const leftCrossProduct = left.numerator * right.denominator;
  const rightCrossProduct = right.numerator * left.denominator;
  if (leftCrossProduct > rightCrossProduct) return -1;
  if (leftCrossProduct < rightCrossProduct) return 1;
  return 0;
}

/** Add two exact rationals without floating-point conversion. */
export function addExactRational(
  left: Readonly<ExactRational>,
  right: Readonly<ExactRational>
): ExactRational {
  assertValidParts(left.numerator, left.denominator);
  assertValidParts(right.numerator, right.denominator);
  return createExactRational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator
  );
}

/** Divide by a positive integer count exactly. */
export function divideExactRationalByInteger(
  value: Readonly<ExactRational>,
  divisor: bigint
): ExactRational {
  assertValidParts(value.numerator, value.denominator);
  if (typeof divisor !== 'bigint') throw new TypeError('ExactRational divisor must be a bigint');
  if (divisor <= ZERO) throw new RangeError('ExactRational divisor must be positive');
  return createExactRational(value.numerator, value.denominator * divisor);
}

/** Explicit display-only conversion; never use this for authoritative comparison. */
export function exactRationalToNumberForDisplay(value: Readonly<ExactRational>): number {
  assertValidParts(value.numerator, value.denominator);
  return Number(value.numerator) / Number(value.denominator);
}

/** Serialize a rational to canonical decimal strings. */
export function serializeExactRational(
  value: Readonly<ExactRational>
): SerializedExactRational {
  const normalized = createExactRational(value.numerator, value.denominator);
  return {
    numerator: normalized.numerator.toString(10),
    denominator: normalized.denominator.toString(10),
  };
}

function parseUnsignedDecimal(value: string, field: 'numerator' | 'denominator'): bigint {
  if (typeof value !== 'string' || !UNSIGNED_DECIMAL.test(value)) {
    throw new TypeError(`SerializedExactRational ${field} must be a canonical unsigned decimal string`);
  }
  return BigInt(value);
}

/** Deserialize decimal strings and restore the canonical normalized form. */
export function deserializeExactRational(
  value: Readonly<SerializedExactRational>
): ExactRational {
  if (!value || typeof value !== 'object') {
    throw new TypeError('SerializedExactRational must be an object');
  }

  return createExactRational(
    parseUnsignedDecimal(value.numerator, 'numerator'),
    parseUnsignedDecimal(value.denominator, 'denominator')
  );
}
