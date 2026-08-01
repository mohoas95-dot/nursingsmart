'use client';

/**
 * features/calendar/DayShiftPicker.tsx
 * ---------------------------------------------------------------------------
 * زیرشاخهٔ یک روز تقویم: انتخاب نوع شیفت + توضیحات همان روز + دکمهٔ تأیید.
 *
 * چرا جدا شد؟ کاربر باید بتواند نوع شیفت را انتخاب کند، در صورت نیاز توضیح
 * بنویسد و بعد با یک «تأیید» دم‌دستی مطمئن شود و سراغ روز بعدی برود. برای همین
 * انتخاب داخل این پنل «پیش‌نویس» است و تا زدن تأیید به تقویم اعمال نمی‌شود.
 *
 * این کامپوننت هم در «ثبت درخواست با انتخاب از روی تقویم» و هم در «ویرایش
 * درخواست روی تقویم» استفاده می‌شود تا رفتار دو بخش دقیقاً یکسان بماند.
 */

import { useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import { toPersianDigits } from '../../lib/persian-vocabulary';

export interface ShiftPickerOption<TCode extends string = string> {
  code: TCode;
  label: string;
  className: string;
}

export interface DayShiftPickerProps<TCode extends string = string> {
  day: number;
  monthName: string;
  weekdayLabel?: string;
  /** مناسبت‌های همان روز، برای یادآوری به کاربر */
  occasions?: string[];
  options: ReadonlyArray<ShiftPickerOption<TCode>>;
  /** مقدار فعلی ثبت‌شده برای این روز (اگر قبلاً انتخاب شده باشد) */
  initialCode?: TCode;
  initialNote?: string;
  /** نمایش کادر توضیحات همان روز */
  showNote?: boolean;
  onConfirm: (code: TCode, note: string) => void;
  onClear?: () => void;
  onCancel?: () => void;
  keyPrefix?: string;
}

export default function DayShiftPicker<TCode extends string = string>({
  day,
  monthName,
  weekdayLabel,
  occasions = [],
  options,
  initialCode,
  initialNote = '',
  showNote = true,
  onConfirm,
  onClear,
  onCancel,
  keyPrefix = 'picker',
}: DayShiftPickerProps<TCode>) {
  const [draftCode, setDraftCode] = useState<TCode | undefined>(initialCode);
  const [draftNote, setDraftNote] = useState<string>(initialNote);

  const selectedOption = options.find(option => option.code === draftCode);

  return (
    <div dir="rtl" className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/70 p-3 space-y-3 shadow-inner">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-black text-slate-800">
          نوع شیفت روز {toPersianDigits(day)} {monthName}
          {weekdayLabel ? ` (${weekdayLabel})` : ''}
        </span>
        <div className="flex items-center gap-1.5">
          {initialCode && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[10px] font-black text-rose-600 hover:bg-rose-50 cursor-pointer"
            >
              <Trash2 className="h-3 w-3" /> حذف این روز
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-black text-slate-500 hover:bg-slate-50 cursor-pointer"
            >
              <X className="h-3 w-3" /> بستن
            </button>
          )}
        </div>
      </div>

      {occasions.length > 0 && (
        <p className="text-[10px] font-bold leading-5 text-indigo-700">🔖 {occasions.join(' — ')}</p>
      )}

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {options.map(option => (
          <button
            type="button"
            key={`${keyPrefix}-${day}-${option.code}`}
            onClick={() => setDraftCode(option.code)}
            aria-pressed={draftCode === option.code}
            className={`relative rounded-xl border px-2 py-2.5 text-[11px] font-black transition-all cursor-pointer ${
              draftCode === option.code
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-[1.04]'
                : `${option.className} hover:brightness-95`
            }`}
          >
            {draftCode === option.code && (
              <Check className="absolute left-1 top-1 h-3 w-3 text-white" />
            )}
            {option.label}
          </button>
        ))}
      </div>

      {showNote && (
        <div className="space-y-1">
          <label
            htmlFor={`${keyPrefix}-note-${day}`}
            className="flex items-center justify-between gap-2 text-[10px] font-black text-slate-600"
          >
            <span>توضیحات این روز (اختیاری)</span>
            <span className="font-bold text-slate-400">
              {toPersianDigits(draftNote.length)} / {toPersianDigits(300)}
            </span>
          </label>
          <textarea
            id={`${keyPrefix}-note-${day}`}
            rows={2}
            maxLength={300}
            value={draftNote}
            onChange={event => setDraftNote(event.target.value)}
            placeholder="مثلاً: به دلیل کلاس آموزشی صبح این روز را عصر می‌خواهم"
            className="w-full resize-y rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[11px] font-bold leading-5 text-slate-700 focus:border-indigo-500 focus:outline-none"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-indigo-200/70 pt-2.5">
        <span className="text-[10px] font-bold text-slate-500">
          {selectedOption
            ? <>انتخاب شما: <b className="text-indigo-700">{selectedOption.label}</b> — برای ثبت، تأیید کنید.</>
            : 'ابتدا نوع شیفت این روز را انتخاب کنید.'}
        </span>
        <button
          type="button"
          disabled={!draftCode}
          onClick={() => draftCode && onConfirm(draftCode, draftNote.trim())}
          className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-[11px] font-black text-white shadow-md shadow-emerald-100 transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 cursor-pointer"
        >
          <Check className="h-3.5 w-3.5" /> تأیید این روز
        </button>
      </div>
    </div>
  );
}
