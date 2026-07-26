'use client';

import React from 'react';
import type { JalaliDateInfo, MonthlySchedule, Personnel, PersonnelReportResult, ShiftType } from '../../../lib/types';
import { JALALI_MONTH_NAMES, WEEKDAYS } from '../../../lib/jalali';

/**
 * PrintScheduleSheet — برگه چاپ/PDF لیست چینش شیفت
 *
 * ویژگی‌ها (مطابق درخواست سرپرستار):
 *  - فقط جدول؛ بدون هدر/منو/حاشیه اضافی، A4 لنداسکیپ، تک‌صفحه
 *  - تمام روزهای ماه (۱ تا ۳۰/۳۱) با نام روز هفته زیر شماره روز
 *  - دو ستون پایانی: مجموع کارکرد «با بهره‌وری» و «بدون بهره‌وری»
 *  - تعطیلات و جمعه‌ها با ترام خاکستری و علامت متمایز (سیاه‌وسفید)
 *  - متن سلول‌ها کم‌رنگ و توخالی (نقطه‌چین‌مانند) برای پررنگ کردن با مداد
 *  - کادر تزئینی دور جدول + تیتر کوتاه با ماه و سال
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
  const cellFontPt = rowCount <= 20 ? 7.5 : rowCount <= 30 ? 6.5 : 5.8;
  const nameFontPt = rowCount <= 20 ? 7.5 : rowCount <= 30 ? 6.8 : 6;

  /**
   * اندازه فونت نام را بر اساس طول نام کوچک می‌کند تا هر نام دقیقاً در یک خط
   * و داخل سلول خودش جا شود و هیچ نامنظمی/شکست خط رخ ندهد.
   */
  const nameFontSizeFor = (fullName: string): number => {
    const len = fullName.trim().length;
    const base = nameFontPt;
    if (len <= 16) return base;
    if (len <= 20) return base - 0.6;
    if (len <= 24) return base - 1.2;
    if (len <= 28) return base - 1.7;
    return Math.max(4.4, base - 2.2);
  };

  const groups: Array<{ key: 'nurse' | 'assistant'; title: string; rows: Personnel[] }> = [
    { key: 'nurse', title: 'پرستاران', rows: activePersonnel.filter((p) => p.jobGroup === 'nurse') },
    { key: 'assistant', title: 'کمک‌بهیاران', rows: activePersonnel.filter((p) => p.jobGroup === 'assistant') },
  ].filter((g) => g.rows.length > 0) as Array<{ key: 'nurse' | 'assistant'; title: string; rows: Personnel[] }>;

  const reportOf = (id: string) => reports.find((r) => r.personnelId === id);

  const renderRow = (p: Personnel, index: number) => {
    const pAssignments = schedule?.assignments?.[p.id] || {};
    const rep = reportOf(p.id);
    const withoutProductivity = Number(rep?.workedHours || 0);
    const withProductivity = withoutProductivity + Number(rep?.productivityHours || 0);

    return (
      <tr key={p.id} style={{ height: `${rowHeightMm}mm` }}>
        <td className="ps-cell ps-name">
          <span className="ps-idx">{toFa(index + 1)}</span>
          <span
            className="ps-name-text"
            style={{ fontSize: `${nameFontSizeFor(`${p.firstName} ${p.lastName}`)}pt` }}
          >
            {p.firstName} {p.lastName}
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
            <td
              key={d.day}
              className={`ps-cell ps-day ${d.isHoliday ? 'ps-holiday' : ''}`}
            >
              <span className="ps-ghost">{text}</span>
            </td>
          );
        })}
        <td className="ps-cell ps-sum-cell">
          <span className="ps-sum">{toFa(withProductivity.toFixed(0))}</span>
        </td>
        <td className="ps-cell ps-sum-cell ps-sum-cell-alt">
          <span className="ps-sum">{toFa(withoutProductivity.toFixed(0))}</span>
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
                  <th key={d.day} className={`ps-cell ps-head ${d.isHoliday ? 'ps-holiday-head' : ''}`}>
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
                <th className="ps-cell ps-head ps-name-head ps-weekday-corner">روزهای ماه ↙</th>
                {calendarDays.map((d) => (
                  <th
                    key={d.day}
                    className={`ps-cell ps-head ps-weekday ${d.isHoliday ? 'ps-holiday-head' : ''}`}
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
                  {g.rows.map((p, i) => renderRow(p, i))}
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
          border: 1.6pt solid #111;
          border-radius: 3mm;
          padding: 1mm;
        }
        .ps-frame-inner {
          border: 0.5pt solid #7a7a7a;
          border-radius: 2mm;
          padding: 2mm 2.5mm 1.5mm;
        }
        .ps-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          border-bottom: 1pt solid #111;
          padding-bottom: 1.2mm;
          margin-bottom: 1.6mm;
        }
        .ps-title-block {
          display: flex;
          align-items: baseline;
          gap: 3mm;
        }
        .ps-title {
          font-size: 14pt;
          font-family: var(--font-titr), var(--font-vazirmatn), Tahoma, sans-serif;
          font-weight: 400;
          letter-spacing: -0.3pt;
          margin: 0;
        }
        .ps-sub {
          font-size: 9pt;
          font-weight: 700;
          color: #333;
          border-right: 1pt solid #999;
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
          background: repeating-linear-gradient(
            45deg,
            #d9d9d9,
            #d9d9d9 1px,
            #fff 1px,
            #fff 3px
          );
          padding: 0 1.2mm;
          border: 0.4pt solid #888;
          border-radius: 1mm;
        }
        .ps-table {
          width: 100%;
          table-layout: fixed;
          border-collapse: collapse;
          border: 1pt solid #222;
        }
        /* خطوط کامل جدول: همه سلول‌ها در هر چهار جهت خط دارند */
        .ps-cell {
          border: 0.5pt solid #4d4d4d;
          text-align: center;
          vertical-align: middle;
          padding: 0;
          overflow: hidden;
        }
        .ps-table thead .ps-cell {
          border: 0.7pt solid #222;
        }
        .ps-table tbody tr:nth-child(even) .ps-cell {
          background-color: #fcfcfc;
        }
        .ps-head {
          font-size: 6.6pt;
          font-weight: 900;
          font-family: var(--font-titr), var(--font-vazirmatn), Tahoma, sans-serif;
          background: #eeeeee;
          line-height: 1.15;
          padding: 0.6mm 0;
        }
        .ps-name-head {
          width: 34mm;
          font-size: 7pt;
        }
        .ps-weekday-corner {
          font-size: 5.6pt;
          color: #555;
        }
        .ps-weekday {
          font-size: 5.8pt;
          color: #222;
          background: #f7f7f7;
        }
        .ps-sum-head {
          width: 13mm;
          font-size: 5.9pt;
          background: #e2e2e2;
        }
        .ps-sum-head-note {
          font-size: 5.3pt;
          color: #333;
        }
        /* هاشور کامل ستون تعطیل/جمعه (سربرگ + همه سلول‌های آن ستون) */
        .ps-holiday-head,
        .ps-table tbody tr .ps-cell.ps-holiday,
        .ps-table tbody tr:nth-child(even) .ps-cell.ps-holiday {
          background-image: repeating-linear-gradient(
            45deg,
            #cfcfcf,
            #cfcfcf 0.5px,
            rgba(255, 255, 255, 0) 0.5px,
            rgba(255, 255, 255, 0) 3px
          );
          background-color: #fbfbfb;
        }
        .ps-name {
          text-align: right;
          padding: 0 1.2mm;
          white-space: nowrap;
          line-height: 1;
        }
        .ps-name-text {
          font-family: var(--font-titr), var(--font-vazirmatn), Tahoma, sans-serif;
          font-weight: 400;
          letter-spacing: -0.1pt;
          display: inline-block;
          max-width: 27mm;
          overflow: hidden;
          white-space: nowrap;
          vertical-align: middle;
        }
        .ps-idx {
          display: inline-block;
          min-width: 4mm;
          color: #999;
          font-weight: 700;
          font-size: 5.4pt;
          vertical-align: middle;
        }
        .ps-day {
          font-size: ${cellFontPt}pt;
        }
        /* حروف شیفت: توخالی، بسیار کم‌رنگ و نقطه‌چین‌مانند برای پررنگ‌کردن با مداد */
        .ps-ghost {
          font-weight: 900;
          font-size: ${cellFontPt}pt;
          letter-spacing: 0.3pt;
          color: #dcdcdc;
          -webkit-text-stroke: 0.18pt #c9c9c9;
          text-shadow: none;
          background-image: repeating-linear-gradient(
            0deg,
            #bdbdbd,
            #bdbdbd 0.6px,
            rgba(255, 255, 255, 0) 0.6px,
            rgba(255, 255, 255, 0) 1.4px
          );
          -webkit-background-clip: text;
          background-clip: text;
          opacity: 0.85;
        }
        .ps-sum {
          font-size: ${cellFontPt + 0.4}pt;
          font-weight: 900;
          color: #d5d5d5;
          -webkit-text-stroke: 0.18pt #bdbdbd;
          background-image: repeating-linear-gradient(
            0deg,
            #b5b5b5,
            #b5b5b5 0.6px,
            rgba(255, 255, 255, 0) 0.6px,
            rgba(255, 255, 255, 0) 1.4px
          );
          -webkit-background-clip: text;
          background-clip: text;
        }
        .ps-sum-cell {
          background-color: #fdfdfd;
        }
        .ps-sum-cell-alt {
          background-color: #f6f6f6;
        }
        .ps-group {
          text-align: right;
          font-size: 6.6pt;
          font-family: var(--font-titr), var(--font-vazirmatn), Tahoma, sans-serif;
          background: #e4e4e4 !important;
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
          border-top: 0.5pt solid #b5b5b5;
          padding-top: 0.8mm;
        }
        .ps-sign {
          color: #666;
        }
        /* اگر مرورگر background-clip:text را پشتیبانی کند، حروف واقعاً نقطه‌چین می‌شوند */
        @supports ((-webkit-background-clip: text) or (background-clip: text)) {
          .ps-ghost,
          .ps-sum {
            color: transparent;
          }
        }
        @media print {
          .ps-sheet {
            page-break-inside: avoid;
          }
          .ps-holiday,
          .ps-holiday-head,
          .ps-head,
          .ps-group,
          .ps-sum-cell,
          .ps-sum-cell-alt,
          .ps-legend-holiday {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  );
};

export default PrintScheduleSheet;
