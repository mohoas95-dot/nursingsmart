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

const WEEKDAY_SHORT = ['ش', '۱ش', '۲ش', '۳ش', '۴ش', '۵ش', 'ج'];

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
  return isLeader ? `${label}*` : label;
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
/** دو ردیف سربرگ جدول (شماره روز + نام روز هفته) */
const THEAD_MM = 10;
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
   * Courier New حدود 0.6em بر هر نویسه عرض می‌گیرد.
   */
  const CHAR_W_EM = 0.62;
  const heightCapPt = rowHeightMm * PT_PER_MM * 0.82;
  const widthCapFor = (chars: number) =>
    ((dayColMm - 0.5) * PT_PER_MM) / (Math.max(1, chars) * CHAR_W_EM);

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

  /** حروف طولانی‌تر شیفت (MEN، مME و…) کوچک‌تر می‌شوند تا در سلول جا شوند */
  const shiftFontSizeFor = (text: string): number =>
    clamp(Math.min(heightCapPt, widthCapFor(text.length)), 4.2, 12);

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
          return (
            <td key={d.day} className={`ps-cell ps-day ${d.isHoliday ? 'ps-holiday' : ''}`}>
              {text && (
                <span className="ps-ghost" style={{ fontSize: `${shiftFontSizeFor(text)}pt` }}>
                  {text}
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
              <span>* : مسئول شیفت</span>
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
                <tr className="ps-head-weekdays">
                  <th className="ps-cell ps-head ps-name-head ps-weekday-corner">روزهای ماه</th>
                  {calendarDays.map((d) => (
                    <th
                      key={d.day}
                      className={`ps-cell ps-head ps-weekday ${d.isHoliday ? 'ps-holiday' : ''}`}
                      title={d.holidayTitle || WEEKDAYS[d.dayOfWeek]}
                    >
                      {WEEKDAY_SHORT[d.dayOfWeek]}
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

      <style jsx>{`
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
          border: 0.8px solid #000 !important;
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
        .ps-weekday {
          font-size: 5.8pt;
          color: #111;
          background-color: #f6f6f6;
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
        .ps-ghost {
          display: inline-block;
          /*
           * فقط فونت‌های mono؛ عرض هر نویسه ۰٫۶em است و محاسبهٔ اندازهٔ حروف به آن تکیه دارد.
           * هیچ فونت متناسب (proportional) نباید در این زنجیره باشد وگرنه «MEN» از سلول بیرون می‌زند.
           * حرف «م» مرخصی با fallback خودکار مرورگر از فونت فارسی سیستم رندر می‌شود.
           */
          font-family: 'Courier New', Courier, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-weight: 700;
          letter-spacing: 0.3pt;
          line-height: 1;
          vertical-align: middle;
          text-align: center;
          /* fallback: مرورگرهای بدون background-clip:text حروف را کم‌رنگ ساده می‌بینند */
          color: #cfcfcf;
          -webkit-text-fill-color: #cfcfcf;
        }
        /*
         * الگوی نقطه‌چین واقعی: نقطه‌های ریز از داخل حروف بریده می‌شوند.
         * واحدها em است تا الگو با هر اندازهٔ فونت (۴٫۵pt تا ۱۲pt) هم‌مقیاس بماند
         * و در هر تراکم پرسنلی «نقطه‌چین» دیده شود، نه لکهٔ توپر یا خالی.
         */
        @supports ((-webkit-background-clip: text) or (background-clip: text)) {
          .ps-ghost {
            color: transparent;
            -webkit-text-fill-color: transparent;
            background-image: radial-gradient(
              circle at 50% 50%,
              #8f8f8f 0.036em,
              rgba(255, 255, 255, 0) 0.043em
            );
            background-size: 0.11em 0.11em;
            background-repeat: repeat;
            -webkit-background-clip: text;
            background-clip: text;
          }
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
