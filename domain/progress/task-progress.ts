/**
 * TaskProgress — Domain Layer (Pure Functions)
 *
 * RESPONSIBILITY:
 *   مدل ریاضی نوار پیشرفت «۰ تا ۱۰۰ درصد» صفحات لودینگ: تبدیل مراحل واقعی
 *   پردازش به درصد پیوسته و تخمین زمان باقی‌مانده.
 *
 * اصول طراحی (تا حس کاربر واقعی و حرفه‌ای باشد):
 *   ۱) هر مرحله سهم مشخصی از نوار دارد؛ رسیدن به یک مرحله = رسیدن به درصد
 *      دقیق شروع همان مرحله. پس درصد همیشه با مرحلهٔ واقعی هم‌گام است.
 *   ۲) داخل هر مرحله، اگر موتور پردازش کسر واقعی پیشرفت را گزارش کند از همان
 *      استفاده می‌شود؛ در غیر این صورت از منحنی زمانی (ease-out) استفاده می‌شود
 *      که تا برآورد مدت مرحله به ۸۵٪ می‌رسد و بعد از آن به‌صورت مجانبی و کند
 *      تا سقف مرحله بالا می‌رود. بنابراین نوار هرگز زودتر از پایان کار پر
 *      نمی‌شود و هرگز هم متوقف به‌نظر نمی‌رسد.
 *   ۳) درصد هیچ‌وقت عقب نمی‌رود (monotone) و تا پیش از اتمام واقعی به ۱۰۰ نمی‌رسد.
 *   ۴) زمان باقی‌مانده از سرعت مشاهده‌شدهٔ واقعی برون‌یابی می‌شود و با برآورد
 *      اولیه ترکیب می‌گردد؛ پس تخمین با گذشت زمان دقیق‌تر می‌شود.
 *
 * PURE: بدون وابستگی به React، Next.js، تایمر یا I/O.
 */

export interface ProgressPhase {
  id: string;
  /** برچسب فارسی مرحله برای نمایش زیر نوار پیشرفت. */
  label: string;
  /** سهم نسبی این مرحله از کل نوار (پیش‌فرض ۱). */
  weight?: number;
  /** برآورد اولیه از مدت این مرحله به میلی‌ثانیه (پیش‌فرض ۱۲۰۰). */
  estimateMs?: number;
}

export interface ResolvedPhase {
  id: string;
  label: string;
  weight: number;
  estimateMs: number;
  /** درصد شروع مرحله (۰ تا ۱۰۰). */
  start: number;
  /** درصد پایان مرحله (۰ تا ۱۰۰). */
  end: number;
}

const DEFAULT_WEIGHT = 1;
const DEFAULT_ESTIMATE_MS = 1_200;

/** بیشترین درصدی که پیش از اعلام پایان واقعی مجاز است. */
export const MAX_RUNNING_PERCENT = 99;

/** نسبت پیشرفت داخل مرحله در لحظه‌ای که زمان برآوردشده تمام می‌شود. */
const ON_ESTIMATE_FRACTION = 0.85;

/** سقف کسر پیشرفت داخل مرحله پیش از رسیدن گزارش واقعی پایان مرحله. */
const MAX_PHASE_FRACTION = 0.995;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * مرزهای درصدی هر مرحله را بر پایهٔ وزن‌ها محاسبه می‌کند.
 * مجموع وزن‌ها به ۱۰۰ نرمال می‌شود، پس تعریف وزن‌ها آزاد است.
 */
export function resolvePhaseBounds(phases: ReadonlyArray<ProgressPhase>): ResolvedPhase[] {
  const safePhases = phases.filter(phase => phase && typeof phase.id === 'string' && phase.id.length > 0);
  if (safePhases.length === 0) {
    return [{
      id: 'default',
      label: 'در حال پردازش',
      weight: 1,
      estimateMs: DEFAULT_ESTIMATE_MS,
      start: 0,
      end: 100,
    }];
  }

  const weights = safePhases.map(phase => {
    const weight = typeof phase.weight === 'number' && Number.isFinite(phase.weight) && phase.weight > 0
      ? phase.weight
      : DEFAULT_WEIGHT;
    return weight;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = 0;
  return safePhases.map((phase, index) => {
    const share = (weights[index] / totalWeight) * 100;
    const start = cursor;
    cursor = index === safePhases.length - 1 ? 100 : cursor + share;
    return {
      id: phase.id,
      label: phase.label,
      weight: weights[index],
      estimateMs: typeof phase.estimateMs === 'number' && Number.isFinite(phase.estimateMs) && phase.estimateMs > 0
        ? phase.estimateMs
        : DEFAULT_ESTIMATE_MS,
      start,
      end: cursor,
    };
  });
}

export function findPhaseIndex(bounds: ReadonlyArray<ResolvedPhase>, phaseId: string | null | undefined): number {
  if (!phaseId) return 0;
  const index = bounds.findIndex(phase => phase.id === phaseId);
  return index === -1 ? 0 : index;
}

/**
 * کسر پیشرفت داخل یک مرحله فقط بر پایهٔ زمان (وقتی موتور پردازش گزارش
 * دقیقی نمی‌دهد). تا انتهای زمان برآوردشده به ۸۵٪ می‌رسد و پس از آن مجانبی
 * جلو می‌رود؛ پس هرگز به ۱۰۰٪ نمی‌رسد مگر مرحله واقعاً تمام شود.
 */
export function timeBasedPhaseFraction(elapsedMs: number, estimateMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const estimate = Number.isFinite(estimateMs) && estimateMs > 0 ? estimateMs : DEFAULT_ESTIMATE_MS;
  const ratio = elapsedMs / estimate;

  if (ratio <= 1) {
    // ease-out cubic: در ابتدا سریع (حس پاسخ‌گویی) و نزدیک برآورد آرام می‌شود.
    const eased = 1 - Math.pow(1 - ratio, 3);
    return clamp(ON_ESTIMATE_FRACTION * eased, 0, ON_ESTIMATE_FRACTION);
  }

  const overtime = ratio - 1;
  const tail = 1 - Math.exp(-overtime * 0.85);
  return clamp(ON_ESTIMATE_FRACTION + (MAX_PHASE_FRACTION - ON_ESTIMATE_FRACTION) * tail, 0, MAX_PHASE_FRACTION);
}

export interface ProgressComputationInput {
  bounds: ReadonlyArray<ResolvedPhase>;
  phaseIndex: number;
  /** زمان سپری‌شده از شروع مرحلهٔ فعلی (میلی‌ثانیه). */
  elapsedInPhaseMs: number;
  /** کسر واقعی گزارش‌شده توسط موتور پردازش (۰ تا ۱) در صورت وجود. */
  reportedFraction?: number | null;
  /** آیا کار به‌طور کامل تمام شده است؟ */
  completed?: boolean;
}

/** درصد کل نوار پیشرفت (۰ تا ۱۰۰). */
export function computeProgressPercent(input: ProgressComputationInput): number {
  const { bounds, completed } = input;
  if (completed) return 100;
  if (bounds.length === 0) return 0;

  const index = clamp(Math.floor(input.phaseIndex), 0, bounds.length - 1);
  const phase = bounds[index];
  const fraction = resolvePhaseFraction(input.reportedFraction, input.elapsedInPhaseMs, phase.estimateMs);
  const percent = phase.start + (phase.end - phase.start) * fraction;
  return clamp(percent, 0, MAX_RUNNING_PERCENT);
}

function resolvePhaseFraction(
  reportedFraction: number | null | undefined,
  elapsedInPhaseMs: number,
  estimateMs: number
): number {
  if (typeof reportedFraction === 'number' && Number.isFinite(reportedFraction)) {
    // گزارش واقعی موتور پردازش اولویت دارد، اما یک خزش زمانی کوچک هم روی آن
    // سوار می‌شود تا بین دو گزارش، نوار «یخ‌زده» به‌نظر نرسد.
    const base = clamp(reportedFraction, 0, MAX_PHASE_FRACTION);
    const creepRoom = Math.max(0, MAX_PHASE_FRACTION - base);
    const creep = creepRoom * timeBasedPhaseFraction(elapsedInPhaseMs, Math.max(estimateMs, 400)) * 0.25;
    return clamp(base + creep, 0, MAX_PHASE_FRACTION);
  }
  return timeBasedPhaseFraction(elapsedInPhaseMs, estimateMs);
}

/**
 * تخمین زمان باقی‌مانده تا پایان کل کار (میلی‌ثانیه).
 *
 * برای مرحلهٔ جاری، اگر پیشرفت واقعی گزارش شده باشد از سرعت مشاهده‌شده
 * برون‌یابی می‌شود و با برآورد ایستا ترکیب می‌گردد؛ در نتیجه هرچه جلوتر
 * می‌رویم تخمین دقیق‌تر می‌شود.
 */
export function estimateRemainingMs(input: ProgressComputationInput): number {
  const { bounds } = input;
  if (input.completed || bounds.length === 0) return 0;

  const index = clamp(Math.floor(input.phaseIndex), 0, bounds.length - 1);
  const phase = bounds[index];
  const fraction = resolvePhaseFraction(input.reportedFraction, input.elapsedInPhaseMs, phase.estimateMs);

  const staticRemaining = Math.max(phase.estimateMs - input.elapsedInPhaseMs, phase.estimateMs * 0.08);
  let currentRemaining = staticRemaining;

  if (fraction > 0.08 && input.elapsedInPhaseMs > 250) {
    const observed = (input.elapsedInPhaseMs / fraction) * (1 - fraction);
    const hasRealSignal = typeof input.reportedFraction === 'number' && Number.isFinite(input.reportedFraction);
    // با سیگنال واقعی به مشاهده بیشتر اعتماد می‌کنیم، وگرنه ترکیب متعادل.
    const observedWeight = hasRealSignal ? 0.75 : 0.4;
    currentRemaining = (observed * observedWeight) + (staticRemaining * (1 - observedWeight));
  }

  const futureRemaining = bounds
    .slice(index + 1)
    .reduce((sum, item) => sum + item.estimateMs, 0);

  return Math.max(0, currentRemaining + futureRemaining);
}

/** قالب‌بندی فارسی زمان باقی‌مانده برای نمایش زیر نوار پیشرفت. */
export function formatRemainingTime(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'کمتر از یک ثانیه';
  const seconds = Math.ceil(remainingMs / 1000);
  if (seconds <= 1) return 'کمتر از یک ثانیه';
  if (seconds < 60) return `حدود ${seconds.toLocaleString('fa-IR')} ثانیه`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (restSeconds === 0) return `حدود ${minutes.toLocaleString('fa-IR')} دقیقه`;
  return `حدود ${minutes.toLocaleString('fa-IR')} دقیقه و ${restSeconds.toLocaleString('fa-IR')} ثانیه`;
}

/**
 * میانگین متحرک نمایی برای یادگیری مدت واقعی مراحل.
 * دفعهٔ بعد که همان عملیات اجرا شود، تخمین دقیق‌تری خواهیم داشت.
 */
export function blendDurationEstimate(previousMs: number | undefined, actualMs: number, alpha = 0.35): number {
  const safeActual = Number.isFinite(actualMs) && actualMs > 0 ? actualMs : DEFAULT_ESTIMATE_MS;
  if (!previousMs || !Number.isFinite(previousMs) || previousMs <= 0) return Math.round(safeActual);
  const blended = (previousMs * (1 - alpha)) + (safeActual * alpha);
  // محدودسازی تا یک اجرای غیرعادی، تخمین را برای همیشه خراب نکند.
  return Math.round(clamp(blended, safeActual * 0.2, safeActual * 5));
}

/** اعمال مدت‌های یادگرفته‌شده روی تعریف مراحل. */
export function applyLearnedEstimates(
  phases: ReadonlyArray<ProgressPhase>,
  learned: Readonly<Record<string, number>> | null | undefined
): ProgressPhase[] {
  if (!learned) return [...phases];
  return phases.map(phase => {
    const learnedMs = learned[phase.id];
    if (!learnedMs || !Number.isFinite(learnedMs) || learnedMs <= 0) return phase;
    return { ...phase, estimateMs: Math.round(learnedMs) };
  });
}

/** درصد نمایشی: هرگز عقب نمی‌رود و با گام محدود جلو می‌رود تا پرش زشت نداشته باشد. */
export function smoothPercent(previousPercent: number, targetPercent: number, maxStep = 6): number {
  if (!Number.isFinite(previousPercent)) return clamp(targetPercent, 0, 100);
  if (targetPercent <= previousPercent) return previousPercent;
  const step = Math.min(targetPercent - previousPercent, Math.max(0.35, maxStep));
  return clamp(previousPercent + step, 0, 100);
}
