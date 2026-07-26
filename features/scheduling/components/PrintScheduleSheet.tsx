'use client';

import React from 'react';
import type { JalaliDateInfo, MonthlySchedule, Personnel, PersonnelReportResult, ShiftType } from '../../../lib/types';
import { JALALI_MONTH_NAMES, WEEKDAYS } from '../../../lib/jalali';

/**
 * PrintScheduleSheet — برگه چاپ/PDF لیست چینش شیفت
 *
 * ویژگی‌ها (مطابق درخواست سرپرستار):
 *  - فقط جدول؛ بدون هدر/منو/حاشیه اضافی، A4 لنداسکیپ، تک‌صفحه
 *  - جدول‌بندی کامل: خطوط افقی و عمودی برای تمام سلول‌ها
 *  - تمام روزهای ماه (۱ تا ۳۰/۳۱) با نام روز هفته زیر شماره روز
 *  - دو ستون پایانی: مجموع کارکرد «با بهره‌وری» و «بدون بهره‌وری»
 *  - تعطیلات و جمعه‌ها با هاشور در کل ستون
 *  - حروف شیفت به‌صورت نقطه‌چین و بسیار کم‌رنگ برای پررنگ‌کردن با مداد
 *  - فونت Lalezar (تیتر فارسی) برای اسامی و عناوین
 */

const WEEKDAY_SHORT = ['ش', '۱ش', '۲ش', '۳ش', '۴ش', '۵ش', 'ج'];

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const toFa = (value: number | string): string =>
  String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

export interface PrintScheduleSheetProps {
  personnel: Personnel[];
  schedule: MonthlySchedule | null;
  reports: PersonnelReportResult[];
  calendarDays: JalaliDateInfo[];
  year: number;
  month: number;
  departmentName?: string;
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

export const PrintScheduleSheet: React.FC<PrintScheduleSheetProps> = ({
  personnel,
  schedule,
  reports,
  calendarDays,
  year,
  month,
  departmentName,
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
  // مقیاس‌بندی خودکار ارتفاع سطر تا همه پرسنل در یک صفحه A4 لنداسکیپ جا شوند
  const rowHeightMm = rowCount <= 14 ? 8 : rowCount <= 20 ? 6.2 : rowCount <= 28 ? 4.8 : rowCount <= 36 ? 3.8 : 3.1;
  const cellFontPt = rowCount <= 20 ? 7.2 : rowCount <= 30 ? 6.4 : 5.6;
  const nameFontPt = rowCount <= 20 ? 8 : rowCount <= 30 ? 7 : 6.2;

  /** اندازه فونت نام بر اساس طول نام، تا هر نام در یک خط و داخل سلول جا شود */
  const nameFontSizeFor = (fullName: string): number => {
    const len = fullName.trim().length;
    const base = nameFontPt;
    if (len <= 14) return base;
    if (len <= 18) return base - 0.7;
    if (len <= 22) return base - 1.3;
    if (len <= 26) return base - 1.9;
    return Math.max(4.6, base - 2.5);
  };

  /** حروف طولانی‌تر شیفت (MEN، مME و…) کوچک‌تر می‌شوند تا در سلول جا شوند */
  const shiftFontSizeFor = (text: string): number => {
    const len = text.length;
    if (len <= 1) return cellFontPt;
    if (len === 2) return cellFontPt - 0.6;
    if (len === 3) return cellFontPt - 1.4;
    return Math.max(3.6, cellFontPt - 2.1);
  };

  const groups = (
    [
      { key: 'nurse' as const, title: 'پرستاران', rows: activePersonnel.filter((p) => p.jobGroup === 'nurse') },
      { key: 'assistant' as const, title: 'کمک‌بهیاران', rows: activePersonnel.filter((p) => p.jobGroup === 'assistant') },
    ]
  ).filter((g) => g.rows.length > 0);

  const reportOf = (id: string) => reports.find((r) => r.personnelId === id);

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
          <span className="ps-ghost ps-ghost-sum">{toFa(withProductivity.toFixed(0))}</span>
        </td>
        <td className="ps-cell ps-sum-cell ps-sum-cell-alt">
          <span className="ps-ghost ps-ghost-sum">{toFa(withoutProductivity.toFixed(0))}</span>
        </td>
      </tr>
    );
  };

  const colSpanAll = calendarDays.length + 3;

  return (
    <div className="ps-sheet" dir="rtl">
      <div className="ps-frame">
        <div className="ps-frame-inner">
          {/* تیتر */}
          <div className="ps-header">
            <div className="ps-title-block">
              <h1 className="ps-title">برنامهٔ ماهانهٔ شیفت</h1>
              <span className="ps-sub">
                {departmentName ? `${departmentName} — ` : ''}
                {JALALI_MONTH_NAMES[month - 1]} {toFa(year)}
              </span>
            </div>
            <div className="ps-legend">
              <span>* : مسئول شیفت</span>
              <span className="ps-legend-holiday">تعطیل / جمعه</span>
            </div>
          </div>

          {/* جدول */}
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
                  {groups.length > 1 && (
                    <tr className="ps-group-row">
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

          {/* پانوشت امضا */}
          <div className="ps-footer">
            <span>تنظیم‌کننده: سرپرستار بخش</span>
            <span className="ps-sign">امضا و تأیید: ....................</span>
            <span>تعداد روزهای ماه: {toFa(calendarDays.length)}</span>
          </div>
        </div>
      </div>

      <style jsx>{`
        .ps-sheet {
          width: 100%;
          font-family: var(--font-vazirmatn), Vazirmatn, Tahoma, sans-serif;
          color: #111;
          background: #fff;
        }
        .ps-frame {
          border: 2px solid #111;
          border-radius: 3mm;
          padding: 1mm;
        }
        .ps-frame-inner {
          border: 1px solid #8a8a8a;
          border-radius: 2mm;
          padding: 2mm 2.5mm 1.5mm;
        }
        .ps-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          border-bottom: 1px solid #111;
          padding-bottom: 1.2mm;
          margin-bottom: 1.6mm;
        }
        .ps-title-block {
          display: flex;
          align-items: baseline;
          gap: 3mm;
        }
        .ps-title {
          font-family: var(--font-titr), var(--font-vazirmatn), Tahoma, sans-serif;
          font-size: 14pt;
          font-weight: 400;
          letter-spacing: -0.3pt;
          margin: 0;
        }
        .ps-sub {
          font-size: 9pt;
          font-weight: 700;
          color: #333;
          border-right: 1px solid #999;
          padding-right: 3mm;
        }
        .ps-legend {
          display: flex;
          gap: 2.5mm;
          font-size: 6.5pt;
          font-weight: 700;
          color: #444;
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

        /* ===== جدول‌بندی کامل: خطوط افقی و عمودی برای همه سلول‌ها ===== */
        .ps-table {
          width: 100%;
          table-layout: fixed;
          border-collapse: collapse;
          border: 1.5px solid #000;
        }
        .ps-cell {
          border: 1px solid #000 !important;
          text-align: center;
          vertical-align: middle;
          padding: 0;
          overflow: hidden;
          line-height: 1.1;
        }
        .ps-head {
          font-family: var(--font-titr), var(--font-vazirmatn), Tahoma, sans-serif;
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

        .ps-name {
          text-align: right;
          padding: 0 1.4mm;
          white-space: nowrap;
        }
        .ps-name-text {
          font-family: var(--font-titr), var(--font-vazirmatn), Tahoma, sans-serif;
          font-weight: 400;
          letter-spacing: -0.1pt;
          display: inline-block;
          max-width: 31mm;
          overflow: hidden;
          white-space: nowrap;
          vertical-align: middle;
        }

        /* ===== حروف شیفت: نقطه‌چین و بسیار کم‌رنگ (قابل پررنگ‌کردن با مداد) ===== */
        .ps-ghost {
          display: inline-block;
          font-family: 'Courier New', var(--font-vazirmatn), monospace;
          font-weight: 700;
          letter-spacing: 0.4pt;
          color: #d8d8d8;
          text-decoration: none;
          -webkit-text-stroke: 0.15px #cfcfcf;
          -webkit-text-fill-color: #d8d8d8;
        }
        .ps-ghost-sum {
          font-size: ${cellFontPt + 0.4}pt;
        }
        /* در مرورگرهای مدرن، حروف با ماسکِ نقطه‌چین رندر می‌شوند */
        @supports ((-webkit-mask-image: radial-gradient(#000, #000)) or (mask-image: radial-gradient(#000, #000))) {
          .ps-ghost {
            color: #b8b8b8;
            -webkit-text-fill-color: #b8b8b8;
            -webkit-mask-image: radial-gradient(circle at 50% 50%, #000 45%, transparent 46%);
            mask-image: radial-gradient(circle at 50% 50%, #000 45%, transparent 46%);
            -webkit-mask-size: 1.1px 1.1px;
            mask-size: 1.1px 1.1px;
            -webkit-mask-repeat: repeat;
            mask-repeat: repeat;
          }
        }

        .ps-sum-cell {
          background-color: #fdfdfd;
        }
        .ps-sum-cell-alt {
          background-color: #f5f5f5;
        }
        .ps-group {
          text-align: right;
          font-family: var(--font-titr), var(--font-vazirmatn), Tahoma, sans-serif;
          font-size: 7pt;
          background-color: #dedede;
          padding: 0.3mm 1.5mm;
          letter-spacing: 0.3pt;
        }
        .ps-group-row {
          height: 4mm;
        }
        .ps-empty {
          padding: 6mm;
          font-size: 8pt;
          color: #777;
        }
        .ps-footer {
          display: flex;
          justify-content: space-between;
          font-size: 6.2pt;
          font-weight: 700;
          color: #444;
          margin-top: 1.2mm;
          border-top: 1px solid #b5b5b5;
          padding-top: 0.8mm;
        }
        .ps-sign {
          color: #666;
        }

        @media print {
          .ps-sheet {
            page-break-inside: avoid;
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
