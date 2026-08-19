/** Ledger-only projection of request outcomes into existing warning severity. */

import {
  createScheduleWarning,
  type ScheduleWarning,
} from '../warnings/schedule-warning';
import type {
  QualityEligibleRequestDayOutcome,
  RequestOutcomeLedger,
  RequestValidationIssue,
} from './request-domain';

function outcomeMessage(
  outcome: QualityEligibleRequestDayOutcome,
  personnelNameById?: ReadonlyMap<string, string>
): string {
  const { requestDay } = outcome;
  const person = personnelNameById?.get(requestDay.personnelId) ?? requestDay.personnelId;
  const identity = `درخواست ${requestDay.requestId} برای ${person} در روز ${requestDay.day}`;
  if (outcome.kind === 'PARTIAL') {
    return `Mismatched Request: ${identity} به‌دلیل محدودیت سخت فقط به‌صورت جزئی اجرا شد.`;
  }
  if (outcome.kind === 'BLOCKED') {
    return `Mismatched Request: ${identity} به‌دلیل محدودیت سخت قابل اجرا نبود.`;
  }
  if (requestDay.requestType === 'pattern') {
    return `Mismatched Request: برای ${person} در روز ${requestDay.day} الگوی شیفت ${requestDay.expectedValue} ثبت شده اما شیفت ${outcome.assignedShift} تخصیص یافته است`;
  }
  if (requestDay.requestType === 'avoid_shift') {
    return `Mismatched Request: برای ${person} در روز ${requestDay.day} تداخل با درخواست عدم تخصیص شیفت ${requestDay.expectedValue} وجود دارد (شیفت ${outcome.assignedShift} تخصیص داده شده)`;
  }
  if (requestDay.requestType === 'OFF') {
    return `Mismatched Request: برای ${person} در روز ${requestDay.day} درخواست OFF ثبت شده اما شیفت ${outcome.assignedShift} تخصیص یافته است`;
  }
  if (requestDay.requestType === 'leave') {
    return `Mismatched Request: برای ${person} در روز ${requestDay.day} درخواست مرخصی ثبت شده اما شیفت ${outcome.assignedShift} تخصیص یافته است`;
  }
  return `Mismatched Request: برای ${person} در روز ${requestDay.day} درخواست شیفت ${requestDay.expectedValue} ثبت شده اما شیفت ${outcome.assignedShift} تخصیص یافته است`;
}

function projectOutcome(
  outcome: QualityEligibleRequestDayOutcome,
  personnelNameById?: ReadonlyMap<string, string>
): ScheduleWarning | null {
  if (outcome.kind === 'EXACT' || outcome.kind === 'COMPATIBLE') return null;
  return createScheduleWarning({
    code: 'MISMATCHED_REQUEST',
    message: outcomeMessage(outcome, personnelNameById),
    day: outcome.requestDay.day,
    personnelId: outcome.requestDay.personnelId,
    shift: outcome.assignedShift,
    metadata: {
      requestId: outcome.requestDay.requestId,
      requestOutcomeKind: outcome.kind,
      requestOutcomeReason: outcome.reason,
      isEssential: outcome.requestDay.isEssential,
      ...(outcome.kind === 'PARTIAL' || outcome.kind === 'BLOCKED'
        ? { hardRule: outcome.provenance[0].hardRule }
        : {}),
    },
  });
}

function issueMessage(issue: RequestValidationIssue): string {
  const ids = issue.requestIds.join('، ');
  return issue.kind === 'INVALID'
    ? `Mismatched Request: درخواست نامعتبر (${ids}) با دلیل ${issue.reason} از سنجش کیفیت کنار گذاشته شد.`
    : `Mismatched Request: درخواست‌های متعارض (${ids}) با دلیل ${issue.reason} از سنجش کیفیت کنار گذاشته شدند.`;
}

/** Project exactly one warning for each deficient outcome or visible issue. */
export function projectRequestWarningsFromLedger(
  ledger: Readonly<RequestOutcomeLedger>,
  personnelNameById?: ReadonlyMap<string, string>
): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  for (const outcome of ledger.outcomes) {
    const warning = projectOutcome(outcome, personnelNameById);
    if (warning) warnings.push(warning);
  }
  for (const issue of ledger.requestIssues) {
    warnings.push(createScheduleWarning({
      code: 'MISMATCHED_REQUEST',
      message: issueMessage(issue),
      day: issue.days?.[0],
      personnelId: issue.personnelId,
      metadata: {
        requestIssueKind: issue.kind,
        requestIssueReason: issue.reason,
        requestIds: issue.requestIds.join(','),
      },
    }));
  }
  return warnings;
}

/** Replace generic verifier request warnings; all non-request warnings are untouched. */
export function replaceRequestWarningsFromLedger(
  existing: ReadonlyArray<ScheduleWarning>,
  ledger: Readonly<RequestOutcomeLedger>,
  personnelNameById?: ReadonlyMap<string, string>
): ScheduleWarning[] {
  return [
    ...existing.filter(warning => warning.code !== 'MISMATCHED_REQUEST'),
    ...projectRequestWarningsFromLedger(ledger, personnelNameById),
  ];
}
