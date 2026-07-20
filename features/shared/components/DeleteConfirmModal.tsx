'use client';

import React from 'react';
import { Trash2 } from 'lucide-react';

/**
 * DeleteConfirmModal — Presentational Component
 *
 * RESPONSIBILITY:
 *   Render a confirmation modal for delete operations.
 *   This is a "dumb" component — it receives all data and handlers as props.
 *
 * Extracted from: app/page.tsx (Phase 6)
 */

export interface DeleteConfirmModalProps {
  isOpen: boolean;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmModal(props: DeleteConfirmModalProps) {
  const { isOpen, label, onConfirm, onCancel } = props;

  if (!isOpen) return null;

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm();
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center z-55 p-4 print:hidden animate-fade-in"
      id="delete-confirm-modal"
      dir="rtl"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onConfirm();
        }
      }}
    >
      <form
        onSubmit={handleConfirm}
        className="bg-white rounded-3xl p-6 max-w-sm w-full border border-slate-200 shadow-2xl space-y-4 text-center"
      >
        <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-2">
          <Trash2 className="w-6 h-6" />
        </div>
        <h3 className="font-extrabold text-slate-900 text-base font-sans">تایید حذف نهایی</h3>
        <p className="text-xs text-slate-500 leading-relaxed font-bold">
          آیا از حذف <b className="text-rose-600">«{label}»</b> اطمینان دارید؟ تمام فعالیت‌ها و شیفت‌های مرتبط نیز پاک خواهند شد. این عملیات غیرقابل بازگشت است.
        </p>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs py-2.5 rounded-xl transition-all cursor-pointer"
          >
            انصراف
          </button>
          <button
            type="submit"
            autoFocus
            className="w-full bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs py-2.5 rounded-xl transition-all cursor-pointer shadow-md shadow-rose-200/20"
            id="btn-confirm-delete-action"
          >
            تایید و حذف دائم
          </button>
        </div>
      </form>
    </div>
  );
}
