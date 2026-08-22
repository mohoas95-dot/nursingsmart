/** Exact Essential/Normal RequestQuality aggregation from the canonical ledger. */

import {
  EXACT_RATIONAL_ZERO,
  addExactRational,
  divideExactRationalByInteger,
  exactRationalToNumberForDisplay,
  type ExactRational,
} from '../math/exact-rational';
import {
  REQUEST_QUALITY_VERSION,
  type RequestOutcomeLedger,
  type RequestQuality,
} from './request-domain';

function aggregateCredits(credits: ReadonlyArray<ExactRational>): ExactRational {
  if (credits.length === 0) return EXACT_RATIONAL_ZERO;
  const sum = credits.reduce(
    (total, credit) => addExactRational(total, credit),
    EXACT_RATIONAL_ZERO
  );
  return divideExactRationalByInteger(sum, BigInt(credits.length));
}

/** Build authoritative quality only from ledger outcomes. */
export function buildRequestQualityFromLedger(
  ledger: Readonly<RequestOutcomeLedger>
): RequestQuality {
  const essentialCredits: ExactRational[] = [];
  const normalCredits: ExactRational[] = [];
  const allCredits: ExactRational[] = [];

  for (const outcome of ledger.outcomes) {
    allCredits.push(outcome.credit);
    if (outcome.requestDay.isEssential) essentialCredits.push(outcome.credit);
    else normalCredits.push(outcome.credit);
  }

  const essentialFulfillment = aggregateCredits(essentialCredits);
  const normalFulfillment = aggregateCredits(normalCredits);
  const allFulfillment = aggregateCredits(allCredits);
  const requestSatisfactionPercent = Number(
    (exactRationalToNumberForDisplay(allFulfillment) * 100).toFixed(2)
  );

  return {
    version: REQUEST_QUALITY_VERSION,
    essentialFulfillment,
    normalFulfillment,
    requestSatisfactionPercent,
  };
}
