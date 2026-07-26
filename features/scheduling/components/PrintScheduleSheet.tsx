'use client';

import React from 'react';
import type { JalaliDateInfo, MonthlySchedule, Personnel, PersonnelReportResult, ShiftType } from '../../../lib/types';
import { JALALI_MONTH_NAMES, WEEKDAYS } from '../../../lib/jalali';

/**
 * PrintScheduleSheet — برگه چاپ/PDF لیست چینش شیفت
 *
 * ویژگی‌ها (مطابق درخواست سرپرستار):
 *  - فقط جدول؛ بدون هدر/منو/حاشیه اضافی، A4 لنداسکیپ، تک‌صفحه
 *  - ساعت موظفی رسمی / قراردادی / وظیفه در بالای صفحه
 *  - جدول‌بندی کامل: خطوط افقی و عمودی برای تمام سلول‌ها
 *  - جدول در وسط صفحه و پرکنندهٔ ارتفاع برگه (ارتفاع سطرها پویا محاسبه می‌شود)
 *  - تمام روزهای ماه (۱ تا ۳۰/۳۱) با نام روز هفته زیر شماره روز
 *  - دو ستون پایانی: مجموع کارکرد «با بهره‌وری» و «بدون بهره‌وری»
 *  - تعطیلات و جمعه‌ها با هاشور در کل ستون
 *  - حروف شیفت به‌صورت نقطه‌چین و بسیار کم‌رنگ برای پررنگ‌کردن با مداد
 *  - فونت Lalezar برای نام پرسنل و عناوین
 *  - تعداد روزهای ماه و تعداد تعطیلات ماه در پانویس
 */

/**
 * نام کامل روزهای هفته (شنبه … جمعه) برای سربرگ جدول.
 * چون عرض هر ستون روز حدود ۷ میلی‌متر است، این نام‌ها به‌صورت عمودی چاپ می‌شوند.
 */
const WEEKDAY_FULL = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

/** نشانهٔ «مسئول شیفت» — گلولهٔ توپر (خاکستری بسیار کم‌رنگ در چاپ) */
const LEADER_MARK = '●';

/** پیشوند فارسی «مرخصی» که پیش از حروف شیفت می‌آید */
const LEAVE_MARK = 'م';

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const toFa = (value: number | string): string =>
  String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** ساعت موظفی به تفکیک نوع استخدام (برای نمایش در بالای برگه) */
export interface PrintDutyHours {
  official: number;
  contract: number;
  conscript: number;
  overtime?: number;
}

export interface PrintScheduleSheetProps {
  personnel: Personnel[];
  schedule: MonthlySchedule | null;
  reports: PersonnelReportResult[];
  calendarDays: JalaliDateInfo[];
  year: number;
  month: number;
  departmentName?: string;
  /** ساعت موظفی رسمی/قراردادی/وظیفه — در نوار بالای برگه چاپ می‌شود */
  dutyHours?: PrintDutyHours | null;
  /** فقط یک گروه شغلی چاپ شود (پرستار یا کمک‌بهیار) — پیش‌فرض: هر دو با تیتر جداگانه */
  jobGroupFilter?: 'nurse' | 'assistant' | null;
}

/** نرمال‌سازی شیفت برای نمایش (حذف پیشوند مرخصی L) */
function displayShift(raw: ShiftType | undefined, isLeader: boolean): string {
  const shift = raw || 'OFF';
  const isLeave = typeof shift === 'string' && shift.startsWith('L') && shift !== 'L';
  const clean = isLeave ? shift.substring(1) : shift;
  if (clean === 'OFF') return '';
  const label = isLeave ? `م${clean}` : clean;
  // نشانهٔ مسئول شیفت: گلولهٔ توپر مشکی (به‌جای ستاره)
  return isLeader ? `${LEADER_MARK}${label}` : label;
}

/* ===== سنجه‌های چیدمان صفحه A4 لنداسکیپ (میلی‌متر) ===== */
/** ارتفاع قابل استفاده برگه: 210mm − حاشیه‌های 4mm بالا/پایین − حاشیه اطمینان */
const PAGE_USABLE_MM = 199;
/** حاشیه‌ها و کادرهای دور برگه */
const FRAME_CHROME_MM = 7.6;
/** نوار تیتر بالای برگه (شامل ساعت موظفی) */
const HEADER_MM = 12.4;
/** پانویس امضا/شمارش روزها */
const FOOTER_MM = 7;
/** ردیف نام کامل روز هفته (عمودی نوشته می‌شود، پس بلندتر است) */
const WEEKDAY_ROW_MM = 15;
/** دو ردیف سربرگ جدول (شماره روز + نام کامل روز هفته به‌صورت عمودی) */
const THEAD_MM = 6 + WEEKDAY_ROW_MM;
/** ردیف عنوان هر گروه شغلی */
const GROUP_ROW_MM = 4.8;

/** عرض مفید جدول روی A4 لنداسکیپ پس از کسر حاشیه‌ها و کادرها */
const TABLE_WIDTH_MM = 280.4;
/** عرض ستون نام (هم‌راستا با ps-name-head) */
const NAME_COL_MM = 34;
/** عرض هر ستون جمع کارکرد (هم‌راستا با ps-sum-head) */
const SUM_COL_MM = 13;
/** تبدیل میلی‌متر به پوینت */
const PT_PER_MM = 2.8346;

export const PrintScheduleSheet: React.FC<PrintScheduleSheetProps> = ({
  personnel,
  schedule,
  reports,
  calendarDays,
  year,
  month,
  departmentName,
  dutyHours = null,
  jobGroupFilter = null,
}) => {
  const activePersonnel = personnel
    .filter((p) => p.active)
    .filter((p) => (jobGroupFilter ? p.jobGroup === jobGroupFilter : true))
    .sort((a, b) => {
      if (a.jobGroup !== b.jobGroup) return a.jobGroup === 'nurse' ? -1 : 1;
      return (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
    });

  const rowCount = activePersonnel.length;

  const groups = (
    [
      { key: 'nurse' as const, title: 'پرستاران', rows: activePersonnel.filter((p) => p.jobGroup === 'nurse') },
      { key: 'assistant' as const, title: 'کمک‌بهیاران', rows: activePersonnel.filter((p) => p.jobGroup === 'assistant') },
    ]
  ).filter((g) => g.rows.length > 0);

  /** ردیف عنوان گروه فقط وقتی چاپ می‌شود که هر دو گروه در یک برگه باشند */
  const groupRowCount = groups.length > 1 ? groups.length : 0;

  /**
   * ارتفاع سطر به‌صورت پویا محاسبه می‌شود تا جدول کل ارتفاع برگه را پر کند
   * و در وسط صفحه بنشیند (به‌جای فشرده‌شدن در بالای برگه).
   */
  const availableMm =
    PAGE_USABLE_MM - FRAME_CHROME_MM - HEADER_MM - FOOTER_MM - THEAD_MM - groupRowCount * GROUP_ROW_MM;
  const rowHeightMm = rowCount > 0 ? clamp(availableMm / rowCount, 2.6, 11) : 8;

  /** عرض واقعی یک سلول روز — تعیین‌کنندهٔ سقف اندازهٔ حروف شیفت */
  const dayColMm =
    calendarDays.length > 0
      ? (TABLE_WIDTH_MM - NAME_COL_MM - SUM_COL_MM * 2) / calendarDays.length
      : 7;

  /**
   * اندازهٔ حروف با هر دو قید محدود می‌شود: ارتفاع سطر و عرض ستون.
   *
   * عرض واقعی هر نویسه در فونت تریسینگ (Raleway Dots) بر حسب em — اندازه‌گیری‌شده
   * از خود فونت. چون این فونت proportional است، به‌جای میانگین، عرض دقیقِ همان
   * نویسه‌ها جمع زده می‌شود تا «MN» (پهن‌ترین ترکیب) هم از سلول بیرون نزند.
   */
  const GHOST_CHAR_W_EM: Record<string, number> = {
    M: 0.87,
    N: 0.76,
    E: 0.64,
    L: 0.57,
    م: 0.64,
  };
  const DEFAULT_CHAR_W_EM = 0.87;
  /** letter-spacing سلول‌ها (۰٫۲pt) هم به عرض هر نویسه اضافه می‌شود */
  const GHOST_TRACKING_EM = 0.03;
  const ghostWidthEm = (text: string): number =>
    [...text].reduce(
      (sum, ch) => sum + (GHOST_CHAR_W_EM[ch] ?? DEFAULT_CHAR_W_EM) + GHOST_TRACKING_EM,
      0
    );
  /*
   * گلولهٔ سرشیفتی در چیدمان absolute و زیر حروف است، پس عرضی اشغال نمی‌کند و
   * در محاسبهٔ اندازهٔ فونت وارد نمی‌شود؛ به همین دلیل اندازهٔ حروف در سلول‌های
   * دارای گلوله و بدون گلوله یکسان می‌ماند.
   * ارتفاع هم کمی محافظه‌کارانه‌تر گرفته شده تا جای گلوله زیر حروف باز بماند.
   */
  const heightCapPt = rowHeightMm * PT_PER_MM * 0.72;
  /** ۰٫۹mm حاشیهٔ امن تا حروف به خطوط سلول نچسبند */
  const widthCapFor = (letters: string) =>
    ((dayColMm - 0.9) * PT_PER_MM) / Math.max(0.5, ghostWidthEm(letters));

  /**
   * اندازهٔ نام عمودی روز هفته: با دو قید محدود می‌شود —
   * طول رشته (بلندترین نام «چهارشنبه» با ۹ نویسه) نباید از ارتفاع ردیف بیشتر شود،
   * و ضخامت خط نوشته نباید از عرض ستون بزند.
   */
  const longestWeekdayChars = Math.max(
    ...calendarDays.map((d) => WEEKDAY_FULL[d.dayOfWeek]?.length ?? 0),
    1
  );
  const weekdayFontPt = clamp(
    Math.min(
      ((WEEKDAY_ROW_MM - 1.2) * PT_PER_MM) / (longestWeekdayChars * 0.58),
      dayColMm * PT_PER_MM * 0.72
    ),
    4.2,
    8
  );

  const nameFontPt = clamp(rowHeightMm * PT_PER_MM * 0.62, 5, 11);
  const sumFontPt = clamp(Math.min(heightCapPt, SUM_COL_MM * PT_PER_MM * 0.28), 5.6, 11);

  /** اندازه فونت نام بر اساس طول نام، تا هر نام در یک خط و داخل سلول جا شود */
  const nameFontSizeFor = (fullName: string): number => {
    const len = fullName.trim().length;
    const base = nameFontPt;
    if (len <= 14) return base;
    if (len <= 18) return base * 0.92;
    if (len <= 22) return base * 0.84;
    if (len <= 26) return base * 0.76;
    return Math.max(4.6, base * 0.68);
  };

  /**
   * اندازهٔ گلولهٔ سرشیفتی فقط به ارتفاع سطر بستگی دارد (نه به طول حروف سلول)،
   * تا همهٔ گلوله‌های برگه یک‌اندازه و یکدست دیده شوند.
   */
  const leaderDotPt = clamp(rowHeightMm * PT_PER_MM * 0.3, 2.6, 5);

  /**
   * حروف طولانی‌تر شیفت (MEN، مME و…) کوچک‌تر می‌شوند تا در سلول جا شوند.
   * گلولهٔ سرشیفتی عمداً در محاسبه نمی‌آید تا اندازهٔ حروف را تغییر ندهد.
   */
  const shiftFontSizeFor = (text: string): number => {
    const hasMark = text.startsWith(LEADER_MARK);
    const letters = hasMark ? text.slice(LEADER_MARK.length) : text;
    return clamp(Math.min(heightCapPt, widthCapFor(letters)), 4.2, 12);
  };

  const reportOf = (id: string) => reports.find((r) => r.personnelId === id);

  /** تعداد تعطیلات ماه = جمعه‌ها + تعطیلات رسمی (همان ستون‌های هاشورخورده) */
  const holidayCount = calendarDays.filter((d) => d.isHoliday).length;

  const dutyChips = dutyHours
    ? [
        { label: 'رسمی', value: dutyHours.official },
        { label: 'قراردادی', value: dutyHours.contract },
        { label: 'وظیفه', value: dutyHours.conscript },
      ].filter((chip) => Number.isFinite(Number(chip.value)))
    : [];

  const renderRow = (p: Personnel) => {
    const pAssignments = schedule?.assignments?.[p.id] || {};
    const rep = reportOf(p.id);
    const withoutProductivity = Number(rep?.workedHours || 0);
    const withProductivity = withoutProductivity + Number(rep?.productivityHours || 0);
    const fullName = `${p.firstName} ${p.lastName}`;

    return (
      <tr key={p.id} style={{ height: `${rowHeightMm}mm` }}>
        <td className="ps-cell ps-name">
          <span className="ps-name-text" style={{ fontSize: `${nameFontSizeFor(fullName)}pt` }}>
            {fullName}
          </span>
        </td>
        {calendarDays.map((d) => {
          const shift = pAssignments[d.day] as ShiftType | undefined;
          const leaders = schedule?.shiftLeaders?.[d.day];
          const isLeader =
            !!leaders &&
            (leaders.morning === p.id || leaders.afternoon === p.id || leaders.night === p.id);
          const text = displayShift(shift, isLeader);
          const hasMark = text.startsWith(LEADER_MARK);
          const letters = hasMark ? text.slice(LEADER_MARK.length) : text;
          // «م» مرخصی در فونت تریسینگ لاتین وجود ندارد؛ جدا می‌شود تا با فونت
          // فارسیِ کم‌رنگ رندر شود و به گلیفِ توپرِ پیش‌فرض برنگردد.
          const leaveMark = letters.startsWith(LEAVE_MARK);
          const latinLetters = leaveMark ? letters.slice(LEAVE_MARK.length) : letters;
          const fontPt = shiftFontSizeFor(text);
          return (
            <td key={d.day} className={`ps-cell ps-day ${d.isHoliday ? 'ps-holiday' : ''}`}>
              {text && (
                <span className="ps-cellbox">
                  {leaveMark && (
                    <span className="ps-leave" style={{ fontSize: `${fontPt * 0.8}pt` }}>
                      {LEAVE_MARK}
                    </span>
                  )}
                  {latinLetters && (
                    <span className="ps-ghost" style={{ fontSize: `${fontPt}pt` }}>
                      {latinLetters}
                    </span>
                  )}
                  {/*
                    گلولهٔ سرشیفتی زیر حروف و خارج از جریان چیدمان (absolute) قرار
                    می‌گیرد تا عرضی اشغال نکند؛ در نتیجه اندازهٔ حروف در سلول‌های
                    دارای گلوله و بدون گلوله دقیقاً یکسان می‌ماند.
                  */}
                  {hasMark && (
                    <span className="ps-leader" style={{ fontSize: `${leaderDotPt}pt` }}>
                      {LEADER_MARK}
                    </span>
                  )}
                </span>
              )}
            </td>
          );
        })}
        <td className="ps-cell ps-sum-cell">
          <span className="ps-sum-text">{toFa(withProductivity.toFixed(0))}</span>
        </td>
        <td className="ps-cell ps-sum-cell ps-sum-cell-alt">
          <span className="ps-sum-text">{toFa(withoutProductivity.toFixed(0))}</span>
        </td>
      </tr>
    );
  };

  const colSpanAll = calendarDays.length + 3;

  return (
    <div className="ps-sheet" dir="rtl">
      <div className="ps-frame">
        <div className="ps-frame-inner">
          {/* تیتر + ساعت موظفی */}
          <div className="ps-header">
            <div className="ps-title-block">
              <h1 className="ps-title">برنامهٔ ماهانهٔ شیفت</h1>
              <span className="ps-sub">
                {departmentName ? `${departmentName} — ` : ''}
                {JALALI_MONTH_NAMES[month - 1]} {toFa(year)}
              </span>
            </div>

            {dutyChips.length > 0 && (
              <div className="ps-duty" aria-label="ساعت موظفی">
                <span className="ps-duty-title">ساعت موظفی</span>
                {dutyChips.map((chip) => (
                  <span key={chip.label} className="ps-duty-chip">
                    <span className="ps-duty-label">{chip.label}</span>
                    <span className="ps-duty-value">{toFa(Number(chip.value))}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="ps-legend">
              <span>{LEADER_MARK} : مسئول شیفت</span>
              <span className="ps-legend-holiday">تعطیل / جمعه</span>
            </div>
          </div>

          {/* جدول — در وسط صفحه و پرکنندهٔ ارتفاع باقی‌مانده */}
          <div className="ps-table-wrap">
            <table className="ps-table">
              <thead>
                <tr className="ps-head-days">
                  <th className="ps-cell ps-head ps-name-head">نام و نام خانوادگی</th>
                  {calendarDays.map((d) => (
                    <th key={d.day} className={`ps-cell ps-head ${d.isHoliday ? 'ps-holiday' : ''}`}>
                      {toFa(d.day)}
                    </th>
                  ))}
                  <th className="ps-cell ps-head ps-sum-head" rowSpan={2}>
                    جمع کارکرد
                    <br />
                    <span className="ps-sum-head-note">با بهره‌وری</span>
                  </th>
                  <th className="ps-cell ps-head ps-sum-head" rowSpan={2}>
                    جمع کارکرد
                    <br />
                    <span className="ps-sum-head-note">بدون بهره‌وری</span>
                  </th>
                </tr>
                <tr className="ps-head-weekdays" style={{ height: `${WEEKDAY_ROW_MM}mm` }}>
                  <th className="ps-cell ps-head ps-name-head ps-weekday-corner">روزهای ماه</th>
                  {calendarDays.map((d) => (
                    <th
                      key={d.day}
                      className={`ps-cell ps-head ps-weekday ${d.isHoliday ? 'ps-holiday' : ''}`}
                      title={d.holidayTitle || WEEKDAYS[d.dayOfWeek]}
                    >
                      {/* نام کامل روز، عمودی چاپ می‌شود تا در عرض ~۷ میلی‌متری ستون جا شود */}
                      <span className="ps-weekday-text">{WEEKDAY_FULL[d.dayOfWeek]}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <React.Fragment key={g.key}>
                    {groupRowCount > 0 && (
                      <tr className="ps-group-row" style={{ height: `${GROUP_ROW_MM}mm` }}>
                        <td className="ps-cell ps-group" colSpan={colSpanAll}>
                          {g.title}
                        </td>
                      </tr>
                    )}
                    {g.rows.map((p) => renderRow(p))}
                  </React.Fragment>
                ))}
                {rowCount === 0 && (
                  <tr>
                    <td className="ps-cell ps-empty" colSpan={colSpanAll}>
                      پرسنلی برای نمایش وجود ندارد.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* پانوشت امضا */}
          <div className="ps-footer">
            <span>تنظیم‌کننده: سرپرستار بخش</span>
            <span className="ps-sign">امضا و تأیید: ....................</span>
            <span className="ps-footer-counts">
              <span>تعداد روزهای ماه: {toFa(calendarDays.length)}</span>
              <span className="ps-footer-sep">|</span>
              <span>تعداد تعطیلات ماه: {toFa(holidayCount)}</span>
            </span>
          </div>
        </div>
      </div>

      {/*
        مهم: این استایل باید global باشد.
        styled-jsx معمولی (scoped) فقط به عناصری کلاسِ scope می‌دهد که مستقیماً در
        همین JSX نوشته شده باشند؛ عناصری که داخل توابع کمکی مثل renderRow یا داخل
        callbackهای map ساخته می‌شوند این کلاس را نمی‌گیرند و در نتیجه کل استایل
        سلول‌های جدول (خطوط، وسط‌چینی، فونت) در خروجی واقعی حذف می‌شد.
        همهٔ کلاس‌ها با پیشوند ps- هستند و برگه فقط هنگام چاپ دیده می‌شود.
      */}
      <style jsx global>{`
        .ps-sheet {
          width: 100%;
          font-family: var(--font-vazirmatn), Vazirmatn, Tahoma, sans-serif;
          color: #111;
          background: #fff;
          /* برگه کل ارتفاع A4 لنداسکیپ را می‌گیرد تا جدول در وسط صفحه بنشیند */
          height: ${PAGE_USABLE_MM}mm;
          display: flex;
          flex-direction: column;
        }
        .ps-frame {
          border: 2px solid #111;
          border-radius: 3mm;
          padding: 1mm;
          flex: 1 1 auto;
          display: flex;
          min-height: 0;
        }
        .ps-frame-inner {
          border: 1px solid #8a8a8a;
          border-radius: 2mm;
          padding: 1.6mm 2.5mm 1.2mm;
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .ps-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 3mm;
          border-bottom: 1px solid #111;
          padding-bottom: 1.2mm;
          margin-bottom: 1.6mm;
          flex: 0 0 auto;
        }
        .ps-title-block {
          display: flex;
          align-items: baseline;
          gap: 3mm;
        }
        .ps-title {
          font-family: var(--font-titr), Lalezar, var(--font-vazirmatn), Tahoma, sans-serif;
          font-size: 14pt;
          font-weight: 400;
          letter-spacing: -0.3pt;
          margin: 0;
          white-space: nowrap;
        }
        .ps-sub {
          font-size: 9pt;
          font-weight: 700;
          color: #333;
          border-right: 1px solid #999;
          padding-right: 3mm;
          white-space: nowrap;
        }

        /* ===== نوار ساعت موظفی (رسمی / قراردادی / وظیفه) ===== */
        .ps-duty {
          display: flex;
          align-items: center;
          gap: 1.4mm;
          border: 1px solid #111;
          border-radius: 1.5mm;
          padding: 0.6mm 1.6mm;
          background-color: #f2f2f2;
        }
        .ps-duty-title {
          font-family: var(--font-titr), Lalezar, var(--font-vazirmatn), Tahoma, sans-serif;
          font-size: 7.4pt;
          font-weight: 400;
          color: #111;
          border-left: 1px solid #9a9a9a;
          padding-left: 1.6mm;
          white-space: nowrap;
        }
        .ps-duty-chip {
          display: inline-flex;
          align-items: baseline;
          gap: 0.8mm;
          white-space: nowrap;
        }
        .ps-duty-label {
          font-size: 6.4pt;
          font-weight: 700;
          color: #333;
        }
        .ps-duty-value {
          font-size: 8.4pt;
          font-weight: 800;
          color: #000;
          border-bottom: 0.6px solid #777;
          padding: 0 0.5mm;
        }

        .ps-legend {
          display: flex;
          gap: 2.5mm;
          font-size: 6.5pt;
          font-weight: 700;
          color: #444;
          white-space: nowrap;
        }
        .ps-legend-holiday {
          background-image: repeating-linear-gradient(
            45deg,
            #c8c8c8,
            #c8c8c8 1px,
            #ffffff 1px,
            #ffffff 3px
          );
          padding: 0 1.2mm;
          border: 1px solid #888;
          border-radius: 1mm;
        }

        /* جدول در وسط فضای باقی‌مانده صفحه */
        .ps-table-wrap {
          flex: 1 1 auto;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 0;
        }

        /* ===== جدول‌بندی کامل: خطوط افقی و عمودی برای همه سلول‌ها ===== */
        .ps-table {
          width: 100%;
          table-layout: fixed;
          border-collapse: collapse;
          border: 1.5px solid #000;
        }
        .ps-cell {
          /* خطوط پررنگ و یکدست، مطابق نمونهٔ مورد نظر سرپرستار */
          border: 1px solid #000 !important;
          text-align: center;
          vertical-align: middle;
          padding: 0;
          overflow: hidden;
          line-height: 1.1;
        }
        /*
         * سلول‌های داده «کف ارتفاع» نداشته باشند: بدون این قاعده، اندازهٔ ارثیِ ۱۶px
         * یک line-box حدود ۴٫۹ میلی‌متری می‌سازد و در بخش‌های پرپرسنل جدول به صفحهٔ دوم می‌رود.
         * محتوای این سلول‌ها همیشه داخل span با فونت مشخص است.
         */
        .ps-name,
        .ps-day,
        .ps-sum-cell {
          font-size: 0;
          line-height: 0;
        }
        .ps-head {
          font-family: var(--font-titr), Lalezar, var(--font-vazirmatn), Tahoma, sans-serif;
          font-size: 6.8pt;
          font-weight: 400;
          background-color: #ededed;
          padding: 0.6mm 0;
        }
        .ps-name-head {
          width: 34mm;
          font-size: 7.2pt;
        }
        .ps-weekday-corner {
          font-size: 5.8pt;
          color: #444;
        }
        /* نام کامل روز هفته: عمودی، تا «چهارشنبه» هم در ستون ~۷ میلی‌متری جا شود */
        .ps-weekday {
          color: #111;
          background-color: #f6f6f6;
          padding: 0.4mm 0;
          font-size: 0;
          line-height: 0;
        }
        .ps-weekday-text {
          display: inline-block;
          writing-mode: vertical-rl;
          -webkit-writing-mode: vertical-rl;
          transform: rotate(180deg);
          white-space: nowrap;
          font-family: var(--font-titr), Lalezar, var(--font-vazirmatn), Tahoma, sans-serif;
          font-size: ${weekdayFontPt}pt;
          font-weight: 400;
          line-height: 1;
          letter-spacing: -0.1pt;
          vertical-align: middle;
        }
        .ps-sum-head {
          width: 13mm;
          font-size: 6pt;
          background-color: #e0e0e0;
        }
        .ps-sum-head-note {
          font-size: 5.4pt;
        }

        /* هاشور کل ستون تعطیل/جمعه (سربرگ + همه سلول‌ها) */
        .ps-holiday {
          background-image: repeating-linear-gradient(
            45deg,
            #c4c4c4,
            #c4c4c4 1px,
            #ffffff 1px,
            #ffffff 3.5px
          );
        }

        /* ===== نام پرسنل با فونت Lalezar ===== */
        .ps-name {
          text-align: right;
          padding: 0 1.4mm;
          white-space: nowrap;
        }
        .ps-name-text {
          font-family: var(--font-titr), Lalezar, 'Lalezar', var(--font-vazirmatn), Tahoma, sans-serif;
          font-weight: 400;
          letter-spacing: -0.1pt;
          display: inline-block;
          max-width: 31mm;
          overflow: hidden;
          white-space: nowrap;
          vertical-align: middle;
          /* لازم است: سلول line-height صفر دارد و بدون این مقدار، نام‌ها محو می‌شوند */
          line-height: 1.15;
        }

        /* ===== حروف شیفت: نقطه‌چین و بسیار کم‌رنگ (قابل پررنگ‌کردن با مداد) ===== */
        .ps-day {
          text-align: center;
          vertical-align: middle;
        }
        /*
         * وسط‌چینی قطعی حروف در سلول: با flex هم افقی و هم عمودی وسط می‌نشینند،
         * مستقل از اینکه گلولهٔ مسئول شیفت باشد یا نه.
         */
        .ps-cellbox {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.12em;
          width: 100%;
          height: 100%;
          line-height: 1;
        }
        /*
         * گلولهٔ مسئول شیفت: زیر حروف و خارج از جریان چیدمان.
         * چون absolute است هیچ عرضی از سلول نمی‌گیرد، پس اندازهٔ حروف در
         * سلول‌های دارای گلوله با بقیهٔ سلول‌ها یکسان می‌ماند.
         */
        .ps-leader {
          position: absolute;
          left: 50%;
          bottom: 0;
          transform: translateX(-50%);
          color: #c2c2c2;
          -webkit-text-fill-color: #c2c2c2;
          line-height: 1;
          pointer-events: none;
        }
        /*
         * ===== حروف انگلیسی شیفت: فونت تریسینگ (نقطه‌چین) و کم‌رنگ =====
         * Raleway Dots یک فونت واقعی «tracing» است: خودِ حروف از نقطه‌های گرد
         * ساخته شده‌اند (نه ماسک CSS روی حروف توپر) و پرسنل روی نقطه‌ها را با
         * مداد پررنگ می‌کنند.
         * مجوز فونت: SIL OFL — از طریق next/font/google خودمیزبان می‌شود.
         * توجه: این فونت proportional است؛ جدول GHOST_CHAR_W_EM بر همین اساس تنظیم شده.
         */
        /* «م» مرخصی: فونت فارسی، هم‌رنگ حروف تریسینگ (فونت لاتین «م» ندارد) */
        .ps-leave {
          display: inline-block;
          font-family: var(--font-vazirmatn), Vazirmatn, Tahoma, sans-serif;
          font-weight: 400;
          line-height: 1;
          vertical-align: middle;
          color: #b0b0b0;
          -webkit-text-fill-color: #b0b0b0;
          flex: 0 0 auto;
        }
        .ps-ghost {
          display: inline-block;
          font-family: var(--font-tracing), 'Raleway Dots', 'Courier New', monospace;
          font-weight: 400;
          letter-spacing: 0.2pt;
          line-height: 1;
          vertical-align: middle;
          text-align: center;
          /* یک درجه پررنگ‌تر از قبل (#9a9a9a) تا در چاپ محو نشود */
          color: #8a8a8a;
          -webkit-text-fill-color: #8a8a8a;
        }

        /* ===== اعداد کارکرد: خاکستری تیره، خوانا و وسط‌چین ===== */
        .ps-sum-cell {
          background-color: #fdfdfd;
          text-align: center;
          vertical-align: middle;
        }
        .ps-sum-cell-alt {
          background-color: #f5f5f5;
        }
        .ps-sum-text {
          display: inline-block;
          font-weight: 800;
          line-height: 1;
          vertical-align: middle;
          text-align: center;
          color: #4a4a4a;
          font-size: ${sumFontPt}pt;
        }

        .ps-group {
          text-align: right;
          font-family: var(--font-titr), Lalezar, var(--font-vazirmatn), Tahoma, sans-serif;
          font-size: 7pt;
          background-color: #dedede;
          padding: 0.3mm 1.5mm;
          letter-spacing: 0.3pt;
        }
        .ps-empty {
          padding: 6mm;
          font-size: 8pt;
          color: #777;
        }
        .ps-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 6.6pt;
          font-weight: 700;
          color: #444;
          margin-top: 1.2mm;
          border-top: 1px solid #b5b5b5;
          padding-top: 0.8mm;
          flex: 0 0 auto;
        }
        .ps-sign {
          color: #666;
        }
        .ps-footer-counts {
          display: inline-flex;
          align-items: center;
          gap: 1.6mm;
          white-space: nowrap;
        }
        .ps-footer-sep {
          color: #aaa;
        }

        @media print {
          .ps-sheet {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .ps-sheet,
          .ps-table,
          .ps-cell,
          .ps-head,
          .ps-holiday,
          .ps-group,
          .ps-ghost,
          .ps-leader,
          .ps-leave,
          .ps-sum-cell,
          .ps-sum-cell-alt,
          .ps-sum-text,
          .ps-duty,
          .ps-legend-holiday {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
    </div>
  );
};

export default PrintScheduleSheet;
