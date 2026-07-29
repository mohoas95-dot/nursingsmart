/**
 * SolverReport — Domain Layer (Pure Functions)
 *
 * RESPONSIBILITY:
 *   تبدیل خروجی موتور هوشمند (solver / scenario generator) به رویدادهای
 *   ساخت‌یافتهٔ «لاگ‌ها و اتفاقات».
 *
 * چرا لازم است؟
 *   تا امروز نتیجهٔ پردازش solver فقط در console.warn و یک alert موقت دیده
 *   می‌شد و هیچ ردی در کارنامه و گزارشات باقی نمی‌ماند. سرپرستار باید بعداً هم
 *   بتواند ببیند «چه زمانی، برای کدام گروه، چند برنامه تولید شد، چقدر طول کشید
 *   و چرا سناریویی کنار گذاشته شد».
 *
 * PURE: بدون وابستگی به React، Next.js، شبکه یا I/O.
 */

import {
  createSystemEventLog,
  type SystemEventInput,
  type SystemEventLog,
  type SystemEventSeverity,
} from './system-events';

export type SolverJobGroup = 'nurse' | 'assistant';

/** حداقل اطلاعاتی که برای گزارش‌نویسی از هر سناریو لازم است. */
export interface SolverScenarioSummary {
  scenarioKey?: string;
  shortTitle?: string;
  totalScore?: number;
  relevantWarningCount?: number;
  relevantHardWarningCount?: number;
  pairwiseDifference?: Record<string, number>;
}

export interface SolverRunReportInput {
  jobGroup: SolverJobGroup;
  year: number;
  month: number;
  monthLabel?: string;
  scenarios: ReadonlyArray<SolverScenarioSummary>;
  /** پیام‌های تشخیصی تولیدشده توسط موتور سناریو (دلیل کنارگذاشتن و…). */
  generationLog?: ReadonlyArray<string>;
  /** مدت پردازش به میلی‌ثانیه. */
  durationMs?: number;
  /** تعداد پرسنل فعالی که این اجرا برایشان برنامه چید. */
  targetPersonnelCount?: number;
  /** تعداد ردیف‌های قفل‌شده‌ای که دست‌نخورده ماندند. */
  lockedRowCount?: number;
  actor?: string;
  at?: string;
}

export const JOB_GROUP_LABELS: Record<SolverJobGroup, string> = {
  nurse: 'پرستاران',
  assistant: 'کمک‌بهیاران',
};

function formatNumber(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return '۰';
  return value.toLocaleString('fa-IR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** مدت پردازش را به شکل خوانا (ثانیه/دقیقه) درمی‌آورد. */
export function formatDuration(durationMs: number | undefined): string | null {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return null;
  const seconds = durationMs / 1000;
  if (seconds < 1) return `${formatNumber(Math.round(durationMs))} میلی‌ثانیه`;
  if (seconds < 60) return `${formatNumber(seconds, 1)} ثانیه`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${formatNumber(minutes)} دقیقه و ${formatNumber(remaining)} ثانیه`;
}

function scenarioLabel(scenario: SolverScenarioSummary, index: number): string {
  const key = scenario.scenarioKey ? `سناریو ${scenario.scenarioKey}` : `سناریو ${index + 1}`;
  return scenario.shortTitle ? `${key} (${scenario.shortTitle})` : key;
}

function describeScenario(scenario: SolverScenarioSummary, index: number): string {
  const parts: string[] = [scenarioLabel(scenario, index)];
  if (typeof scenario.totalScore === 'number' && Number.isFinite(scenario.totalScore)) {
    parts.push(`امتیاز ${formatNumber(scenario.totalScore, 1)}`);
  }
  const warnings = scenario.relevantWarningCount ?? 0;
  const hardWarnings = scenario.relevantHardWarningCount ?? 0;
  parts.push(warnings === 0 ? 'بدون هشدار' : `${formatNumber(warnings)} هشدار`);
  if (hardWarnings > 0) parts.push(`${formatNumber(hardWarnings)} هشدار سخت`);
  return parts.join(' · ');
}

/**
 * گزارش کامل یک اجرای solver را به رویدادهای «لاگ‌ها و اتفاقات» تبدیل می‌کند.
 *
 * خروجی همیشه شامل یک رویداد خلاصه است (چند برنامه تولید شد، چقدر طول کشید و
 * وضعیت هشدارها) و در صورت وجود پیام‌های تشخیصی، یک رویداد هشدار جداگانه هم
 * افزوده می‌شود تا دلیل تولید نشدن هر سه برنامه در سامانه بماند.
 */
export function buildSolverRunEvents(
  input: SolverRunReportInput,
  now: Date = new Date()
): SystemEventLog[] {
  const groupLabel = JOB_GROUP_LABELS[input.jobGroup];
  const monthLabel = input.monthLabel || `${input.month}/${input.year}`;
  const scenarioCount = input.scenarios.length;
  const duration = formatDuration(input.durationMs);

  const totalWarnings = input.scenarios.reduce(
    (sum, scenario) => sum + (scenario.relevantWarningCount ?? 0),
    0
  );
  const totalHardWarnings = input.scenarios.reduce(
    (sum, scenario) => sum + (scenario.relevantHardWarningCount ?? 0),
    0
  );
  const bestScore = input.scenarios.reduce<number | null>((best, scenario) => {
    if (typeof scenario.totalScore !== 'number' || !Number.isFinite(scenario.totalScore)) return best;
    return best === null || scenario.totalScore > best ? scenario.totalScore : best;
  }, null);

  const severity: SystemEventSeverity =
    scenarioCount === 0 ? 'error' : scenarioCount < 3 || totalHardWarnings > 0 ? 'warning' : 'success';

  const title = scenarioCount === 0
    ? `موتور هوشمند برای ${groupLabel} هیچ برنامه‌ای تولید نکرد`
    : `موتور هوشمند ${formatNumber(scenarioCount)} برنامه پیشنهادی برای ${groupLabel} تولید کرد`;

  const detailParts: string[] = [`ماه ${monthLabel}`];
  if (duration) detailParts.push(`زمان پردازش: ${duration}`);
  if (typeof input.targetPersonnelCount === 'number') {
    detailParts.push(`${formatNumber(input.targetPersonnelCount)} نفر پرسنل هدف`);
  }
  if (input.lockedRowCount) {
    detailParts.push(`${formatNumber(input.lockedRowCount)} ردیف قفل‌شده دست‌نخورده ماند`);
  }
  if (bestScore !== null) detailParts.push(`بهترین امتیاز: ${formatNumber(bestScore, 1)}`);
  detailParts.push(totalWarnings === 0
    ? 'مجموع هشدارها: بدون هشدار'
    : `مجموع هشدارها: ${formatNumber(totalWarnings)}${totalHardWarnings > 0 ? ` (${formatNumber(totalHardWarnings)} سخت)` : ''}`);
  if (scenarioCount > 0) {
    detailParts.push(
      input.scenarios.map((scenario, index) => describeScenario(scenario, index)).join(' | ')
    );
  }

  const events: SystemEventInput[] = [{
    category: 'solver',
    severity,
    title,
    detail: detailParts.join(' — '),
    actor: input.actor,
    at: input.at,
  }];

  const diagnostics = (input.generationLog || []).filter(line => typeof line === 'string' && line.trim().length > 0);
  if (diagnostics.length > 0) {
    events.push({
      category: 'solver',
      severity: scenarioCount < 3 ? 'warning' : 'info',
      title: `جزئیات تشخیصی پردازش ${groupLabel}`,
      detail: diagnostics.join(' | '),
      actor: input.actor,
      at: input.at,
    });
  }

  return events.map(event => createSystemEventLog(event, now));
}
