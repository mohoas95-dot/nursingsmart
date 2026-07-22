'use client';

import React from 'react';
import type { Personnel } from '../../../lib/types';

/**
 * AddPersonnelModal — Presentational Component
 *
 * RESPONSIBILITY:
 *   Render the personnel add/edit form modal.
 *   This is a "dumb" component — it receives all state and handlers as props.
 *
 * Extracted from: app/page.tsx (lines ~5716-5903)
 * Risk Score: 3/14 (isolated modal, clear props interface)
 */

export interface AddPersonnelModalProps {
  // Visibility
  isOpen: boolean;
  onClose: () => void;

  // Editing mode
  editingPersonnel: Personnel | null;

  // Form state
  formFirstName: string;
  formLastName: string;
  formPersonalCode: string;
  formNationalId: string;
  isLoadingNationalId?: boolean;
  formJobGroup: 'nurse' | 'assistant';
  formPosition: 'supervisor' | 'staff' | 'general' | 'none';
  formEmploymentType: 'official' | 'contract' | 'conscript' | 'overtime';
  formExperienceYears: number | string;
  formActive: boolean;
  formCanBeShiftLeader: boolean;
  formIsFixedRoutine?: boolean;
  formRoutineType?: Personnel['routineType'];
  formRoutinePattern?: string;

  // Form setters
  setFormFirstName: (value: string) => void;
  setFormLastName: (value: string) => void;
  setFormPersonalCode: (value: string) => void;
  setFormNationalId: (value: string) => void;
  setFormJobGroup: (value: 'nurse' | 'assistant') => void;
  setFormPosition: (value: 'supervisor' | 'staff' | 'general' | 'none') => void;
  setFormEmploymentType: (value: 'official' | 'contract' | 'conscript' | 'overtime') => void;
  setFormExperienceYears: (value: number | string) => void;
  setFormActive: (value: boolean) => void;
  setFormCanBeShiftLeader: (value: boolean) => void;
  setFormIsFixedRoutine?: (value: boolean) => void;
  setFormRoutineType?: (value: Personnel['routineType']) => void;
  setFormRoutinePattern?: (value: string) => void;

  // Submit handler
  onSubmit: (e: React.FormEvent) => void;

  // Helper
  parseNumberInput: (val: string) => number | string;
}

export function AddPersonnelModal(props: AddPersonnelModalProps) {
  const {
    isOpen,
    onClose,
    editingPersonnel,
    formFirstName,
    formLastName,
    formPersonalCode,
    formNationalId,
    isLoadingNationalId = false,
    formJobGroup,
    formPosition,
    formEmploymentType,
    formExperienceYears,
    formActive,
    formCanBeShiftLeader,
    formIsFixedRoutine,
    formRoutineType = 'none',
    formRoutinePattern = '',
    setFormFirstName,
    setFormLastName,
    setFormPersonalCode,
    setFormNationalId,
    setFormJobGroup,
    setFormPosition,
    setFormEmploymentType,
    setFormExperienceYears,
    setFormActive,
    setFormCanBeShiftLeader,
    setFormIsFixedRoutine,
    setFormRoutineType,
    setFormRoutinePattern,
    onSubmit,
    parseNumberInput,
  } = props;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 print:hidden animate-fade-in"
      id="personnel-modal"
    >
      <div className="bg-white border rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6 shadow-2xl relative scrollbar-thin">
        <button
          onClick={onClose}
          className="absolute top-4 left-4 text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg p-1.5 cursor-pointer"
        >
          ✕
        </button>

        <h3 className="text-base font-black text-slate-800 mb-6 border-b pb-3 border-slate-100">
          {editingPersonnel ? 'ویرایش اطلاعات پرسنلی' : 'تعریف پرسنل جدید'}
        </h3>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">نام</label>
              <input
                type="text"
                value={formFirstName}
                onChange={(e) => setFormFirstName(e.target.value)}
                className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                id="input-form-fname"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">نام خانوادگی</label>
              <input
                type="text"
                value={formLastName}
                onChange={(e) => setFormLastName(e.target.value)}
                className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                id="input-form-lname"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">کد پرسنلی (اختیاری)</label>
            <input
              type="text"
              value={formPersonalCode}
              onChange={(e) => setFormPersonalCode(e.target.value)}
              className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none font-mono"
              id="input-form-code"
              placeholder="در صورت وجود وارد کنید"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">کد ملی برای ورود به سامانه</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={10}
              value={formNationalId}
              disabled={isLoadingNationalId}
              onChange={(e) => setFormNationalId(e.target.value)}
              className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none font-mono text-center disabled:bg-slate-100 disabled:text-slate-400"
              id="input-form-national-id"
              placeholder={isLoadingNationalId ? 'در حال دریافت کد ملی...' : (editingPersonnel ? 'کد ملی را در صورت نیاز اصلاح کنید' : 'رمز اولیه حساب: ۱۲۳۴')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">گروه شغلی</label>
              <select
                value={formJobGroup}
                onChange={(e) => {
                  const mode = e.target.value as 'nurse' | 'assistant';
                  setFormJobGroup(mode);
                  if (mode === 'assistant') {
                    setFormPosition('none');
                    setFormCanBeShiftLeader(false);
                  } else {
                    setFormPosition('general');
                    setFormCanBeShiftLeader(true);
                  }
                }}
                className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                id="select-form-job"
              >
                <option value="nurse">پرستار</option>
                <option value="assistant">کمک بهیار</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">سمت پرستاری</label>
              <select
                value={formPosition}
                disabled={formJobGroup === 'assistant'}
                onChange={(e) => setFormPosition(e.target.value as any)}
                className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                id="select-form-position"
              >
                <option value="none">بدون سمت</option>
                <option value="supervisor">سرپرستار</option>
                <option value="staff">استاف</option>
                <option value="general">کارشناس عمومی</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">نوع استخدام</label>
              <select
                value={formEmploymentType}
                onChange={(e) => setFormEmploymentType(e.target.value as any)}
                className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                id="select-form-emptype"
              >
                <option value="official">رسمی</option>
                <option value="contract">قراردادی</option>
                <option value="conscript">طرح / وظیفه</option>
                <option value="overtime">اضافه‌کاری</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">سابقه کار (سال)</label>
              <input
                type="number"
                value={formExperienceYears}
                onChange={(e) => setFormExperienceYears(parseNumberInput(e.target.value))}
                className="w-full text-xs font-extrabold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                id="input-form-years"
              />
            </div>
          </div>

          <div className="pt-3 flex flex-col gap-3 border-t border-slate-100">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                checked={formActive}
                onChange={(e) => setFormActive(e.target.checked)}
                className="rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
              />
              کاربر فعال باشد (حضور در برنامه‌ریزی)
            </label>

            {formJobGroup !== 'assistant' && (
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={formCanBeShiftLeader}
                  disabled={formPosition === 'supervisor'}
                  onChange={(e) => setFormCanBeShiftLeader(e.target.checked)}
                  className="rounded border-slate-300 accent-indigo-600 text-indigo-600"
                />
                قابلیت سرشیفت شدن (ویژه استاف و کارشناس عمومی)
              </label>
            )}

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 space-y-3">
              <label className="flex items-start gap-2 cursor-pointer text-xs font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={!!formIsFixedRoutine}
                  onChange={(e) => setFormIsFixedRoutine?.(e.target.checked)}
                  className="rounded border-amber-300 accent-amber-600 text-amber-600 mt-0.5"
                />
                <span className="leading-5">
                  برچسب راهنما قدیمی: <b>روتین ثابت</b> — نگه داشته شده برای سازگاری (اکنون از فیلد روتین دقیق زیر استفاده کنید)
                </span>
              </label>

              <div className="space-y-2 pt-2 border-t border-amber-100">
                <label className="block text-[11px] font-black text-amber-800">🎯 تگ روتین شیفت (راهنمای Solver — تحلیل سنگین را دور می‌زند، محدودیت سفت ایجاد نمی‌کند)</label>
                <select
                  value={formRoutineType}
                  onChange={(e) => setFormRoutineType?.(e.target.value as any)}
                  className="w-full text-xs font-bold bg-white border border-amber-300 rounded-xl px-3 py-2.5 focus:border-amber-500 focus:outline-none"
                  id="select-routine-type"
                >
                  <option value="none">بدون روتین خاص — Solver آزاد</option>
                  <option value="morning">صبح‌کار (M) — فقط صبح</option>
                  <option value="morning_evening">صبح و عصر کار (M,E,ME)</option>
                  <option value="evening_night">عصر و شب کار (E,N,EN)</option>
                  <option value="night">شب‌کار (N,EN,MN)</option>
                  <option value="24h">۲۴ ساعته (MEN,EN,MN,ME)</option>
                  <option value="rotating">چرخشی (برخی روزها ۲۴، برخی عصر+شب، برخی صبح/شب تک) — الگوی کلاسیک</option>
                  <option value="custom">سفارشی — الگو را دستی وارد کن</option>
                </select>
                <p className="text-[10px] text-slate-500 font-bold leading-5">
                  چرخشی یعنی: بعضی روزها ۲۴ میاد (MEN)، بعضی مواقع عصر و شب (EN)، بعضی مواقع صبح تک (M) یا شب تک (N). Solver به این روتین احترام می‌گذارد و از تکه‌تکه شدن M M E E N جلوگیری می‌کند و شیفت‌ها را خوشه‌ای (Shift Clustering) می‌چیند.
                </p>

                {formRoutineType === 'custom' && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">الگوی سفارشی (مثال: MEN OFF OFF EN M N OFF)</label>
                    <input
                      type="text"
                      value={formRoutinePattern}
                      onChange={(e) => setFormRoutinePattern?.(e.target.value)}
                      placeholder="MEN OFF OFF EN M N OFF"
                      className="w-full text-xs font-bold bg-white border border-amber-300 rounded-xl px-3 py-2.5 focus:border-amber-500 focus:outline-none font-mono"
                      id="input-routine-pattern"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoadingNationalId}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed text-white font-extrabold text-xs py-3 rounded-xl shadow-lg mt-4 cursor-pointer"
            id="btn-save-form-personnel"
          >
            ثبت اطلاعات و به‌روزرسانی بانک داده
          </button>
        </form>
      </div>
    </div>
  );
}
