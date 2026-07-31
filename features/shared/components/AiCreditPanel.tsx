'use client';

import React from 'react';
import { AlertTriangle, DollarSign, Zap, TrendingDown, RefreshCw, Info, CreditCard, Wallet, CheckCircle2, Loader2, X, History } from 'lucide-react';

/**
 * AiCreditPanel — نمایش اعتبار ۱۰۰ دلاری و هشدارهای زرد/قرمز برای سرپرستار
 *
 * الزامات:
 *   - نمایش Credit: $84.50 / $100
 *   - هشدار زرد < 15 دلار: "⚠️ اعتبار API به پایان خود نزدیک است (باقی‌مانده: $X). لطفاً جهت جلوگیری از قطعی سرویس نسبت به شارژ اقدام کنید."
 *   - هشدار قرمز < 5 دلار: critical alert
 *   - دکمه «شارژ مجدد ۱۰۰ دلار» در کنار نمایشگر اعتبار با مودال تأیید:
 *       POST /api/ai/credit  body: { action: "recharge", amount: 100 }
 *       → اعتبار باقی‌مانده دوباره به $100.00 برمی‌گردد و بنرهای زرد/قرمز ریست می‌شوند.
 *   - نمایش لاگ هر درخواست (مدل، توکن ورودی/خروجی، هزینه کسرشده به دلار)
 *
 * این کامپوننت از /api/ai/credit یا props می‌تواند تغذیه شود.
 */

export interface AiCreditLog {
  at: string;
  kind: 'request' | 'recharge';
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  amount?: number;
  remaining: number;
  isFallback?: boolean;
}

export interface AiCreditData {
  initial: number;
  remaining: number;
  spent: number;
  percentRemaining: number;
  display?: string;
  status: 'ok' | 'warning' | 'critical' | 'depleted';
  isWarning?: boolean;
  isCritical?: boolean;
  warningMessage?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  requestCount: number;
  byModel?: Record<string, { inputTokens: number; outputTokens: number; cost: number; count: number }>;
  lastRequest?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    at: string;
  };
  logs?: AiCreditLog[];
}

export interface AiCreditPanelProps {
  credit: AiCreditData | null;
  isLoading?: boolean;
  onRefresh?: () => void;
  /** پس از شارژ مجدد موفق با دادهٔ تازهٔ اعتبار صدا زده می‌شود (برای ریست بنرهای هشدار در صفحه) */
  onRecharged?: (credit: AiCreditData) => void;
  className?: string;
}

function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

function formatLogTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** مودال تأیید شارژ مجدد — «شارژ مجدد ۱۰۰ دلار» */
export function RechargeConfirmModal({
  isOpen,
  onConfirm,
  onCancel,
  isRecharging,
}: {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isRecharging?: boolean;
}) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center z-55 p-4 print:hidden animate-fade-in"
      id="recharge-confirm-modal"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="تایید شارژ مجدد اعتبار"
    >
      <div className="bg-white rounded-3xl p-6 max-w-sm w-full border border-slate-200 shadow-2xl space-y-4 text-center">
        <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-2">
          <Wallet className="w-6 h-6" />
        </div>
        <h3 className="font-extrabold text-slate-900 text-base font-sans">تایید شارژ مجدد اعتبار</h3>
        <p className="text-xs text-slate-500 leading-relaxed font-bold">
          آیا از <b className="text-emerald-600">شارژ مجدد ۱۰۰ دلاری</b> اعتبار سرویس هوش مصنوعی اطمینان دارید؟
          <br />
          اعتبار باقی‌مانده به <b className="font-mono" dir="ltr">$100.00</b> بازمی‌گردد و
          هشدارهای زرد/قرمز به حالت عادی ریست می‌شوند.
        </p>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isRecharging}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs py-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-50"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isRecharging}
            autoFocus
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs py-2.5 rounded-xl transition-all cursor-pointer shadow-md shadow-emerald-200/30 disabled:opacity-60 flex items-center justify-center gap-1.5"
            id="btn-confirm-recharge"
          >
            {isRecharging ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                در حال شارژ…
              </>
            ) : (
              'تایید و شارژ مجدد'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AiCreditPanel({ credit, isLoading, onRefresh, onRecharged, className = '' }: AiCreditPanelProps) {
  const [showRechargeConfirm, setShowRechargeConfirm] = React.useState(false);
  const [isRecharging, setIsRecharging] = React.useState(false);
  const [rechargeError, setRechargeError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const successTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, []);

  if (isLoading) {
    return (
      <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
        <div className="flex items-center gap-3 animate-pulse">
          <div className="h-10 w-10 rounded-xl bg-slate-200" />
          <div className="space-y-2 flex-1">
            <div className="h-4 w-32 bg-slate-200 rounded" />
            <div className="h-3 w-48 bg-slate-100 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!credit) {
    return (
      <div className={`rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-center gap-2 ${className}`}>
        <Info className="w-5 h-5 text-amber-600" />
        <span className="text-xs font-bold text-amber-800">اطلاعات اعتبار در دسترس نیست.</span>
        {onRefresh && (
          <button onClick={onRefresh} className="mr-auto rounded-lg bg-white border border-amber-200 px-3 py-1 text-[10px] font-black hover:bg-amber-100">
            تلاش مجدد
          </button>
        )}
      </div>
    );
  }

  const status = credit.status;
  const isWarning = status === 'warning' || credit.isWarning;
  const isCritical = status === 'critical' || status === 'depleted' || credit.isCritical;

  const statusConfig = isCritical
    ? {
        bg: 'bg-gradient-to-br from-rose-50 to-red-50 border-rose-300',
        iconBg: 'bg-rose-500',
        icon: AlertTriangle,
        titleColor: 'text-rose-800',
        progressColor: 'bg-rose-500',
        label: 'بحرانی',
        labelClass: 'bg-rose-100 text-rose-700 border-rose-200',
      }
    : isWarning
    ? {
        bg: 'bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-300',
        iconBg: 'bg-amber-500',
        icon: AlertTriangle,
        titleColor: 'text-amber-800',
        progressColor: 'bg-amber-500',
        label: 'هشدار',
        labelClass: 'bg-amber-100 text-amber-800 border-amber-200',
      }
    : {
        bg: 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200',
        iconBg: 'bg-emerald-600',
        icon: DollarSign,
        titleColor: 'text-emerald-800',
        progressColor: 'bg-emerald-600',
        label: 'عادی',
        labelClass: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      };

  const Icon = statusConfig.icon;

  const performRecharge = async () => {
    if (isRecharging) return;
    setIsRecharging(true);
    setRechargeError(null);
    try {
      const res = await fetch('/api/ai/credit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recharge', amount: 100 }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'خطا در شارژ مجدد اعتبار');
      }
      const freshCredit = data.credit as AiCreditData;
      setShowRechargeConfirm(false);
      setSuccessMessage('اعتبار با موفقیت شارژ مجدد شد؛ هشدارها به حالت عادی بازگشتند. ✔');
      if (successTimer.current) clearTimeout(successTimer.current);
      successTimer.current = setTimeout(() => setSuccessMessage(null), 5000);
      onRecharged?.(freshCredit);
      // همگام‌سازی با منبع حقیقت سرور
      onRefresh?.();
    } catch (e) {
      setRechargeError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRecharging(false);
    }
  };

  const recentLogs = credit.logs ?? [];

  return (
    <>
    <div className={`rounded-2xl border-2 shadow-sm overflow-hidden ${statusConfig.bg} ${className}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shadow-sm ${statusConfig.iconBg} text-white`}>
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <h4 className={`text-sm font-black flex items-center gap-2 ${statusConfig.titleColor}`}>
              اعتبار سرویس هوش مصنوعی
              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${statusConfig.labelClass}`}>
                {statusConfig.label}
              </span>
            </h4>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
              مدیریت هزینه API از طریق OpenRouter — مدل متنی DeepSeek و بینایی GPT-4o-mini
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* دکمه شارژ مجدد ۱۰۰ دلار — در کنار نمایشگر اعتبار */}
          <button
            onClick={() => {
              setRechargeError(null);
              setShowRechargeConfirm(true);
            }}
            disabled={isRecharging}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-black transition-all cursor-pointer shadow-sm disabled:opacity-60 ${
              isCritical
                ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200'
                : isWarning
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200/40'
            }`}
            title="شارژ مجدد ۱۰۰ دلاری اعتبار"
            id="btn-recharge-credit"
          >
            {isRecharging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
            شارژ مجدد ۱۰۰ دلار
          </button>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="rounded-xl bg-white border border-slate-200 p-2 hover:bg-slate-50 transition-colors shadow-xs"
              title="به‌روزرسانی"
            >
              <RefreshCw className="w-4 h-4 text-slate-600" />
            </button>
          )}
        </div>
      </div>

      {/* پیام موفقیت شارژ */}
      {successMessage && (
        <div className="mx-4 mb-3 rounded-xl border-2 border-emerald-300 bg-emerald-100 px-3.5 py-2.5 flex items-center gap-2 text-emerald-900">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <p className="text-[11px] font-black leading-5">{successMessage}</p>
        </div>
      )}

      {/* خطای شارژ */}
      {rechargeError && (
        <div className="mx-4 mb-3 rounded-xl border-2 border-rose-300 bg-rose-100 px-3.5 py-2.5 flex items-center gap-2 text-rose-900">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
          <p className="text-[11px] font-black leading-5 flex-1">{rechargeError}</p>
          <button onClick={() => setRechargeError(null)} className="shrink-0 p-1 hover:bg-rose-200 rounded-lg" title="بستن">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Credit Display — الزام اصلی: نمایش Credit: $84.50 / $100 */}
      <div className="px-5 pb-3">
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black font-mono text-slate-800" dir="ltr">
              ${credit.remaining.toFixed(2)}
            </span>
            <span className="text-sm font-bold text-slate-400 font-mono" dir="ltr">
              / ${credit.initial.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-black text-slate-500">
              {credit.percentRemaining.toFixed(1)}% باقی‌مانده
            </span>
            <TrendingDown className={`w-4 h-4 ${isCritical ? 'text-rose-500' : isWarning ? 'text-amber-500' : 'text-emerald-500'}`} />
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-3 h-2.5 w-full rounded-full bg-slate-200/70 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${statusConfig.progressColor}`}
            style={{ width: `${Math.min(100, Math.max(0, credit.percentRemaining))}%` }}
          />
        </div>

        <div className="mt-2 flex justify-between text-[10px] font-bold text-slate-400">
          <span dir="ltr">$0</span>
          <span dir="ltr">${credit.initial.toFixed(0)}</span>
        </div>
      </div>

      {/* Warning Alert — دقیقاً متن خواسته شده */}
      {(isWarning || isCritical) && credit.warningMessage && (
        <div className={`mx-4 mb-4 rounded-xl border-2 p-3.5 flex gap-3 ${isCritical ? 'bg-rose-600 border-rose-700 text-white shadow-lg shadow-rose-200' : 'bg-amber-100 border-amber-300 text-amber-900'}`}>
          <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${isCritical ? 'bg-white/20' : 'bg-amber-500 text-white'}`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-black leading-6 ${isCritical ? 'text-white' : 'text-amber-900'}`}>
              {credit.warningMessage}
            </p>
            {isCritical && (
              <p className="mt-1 text-[11px] font-bold text-white/90 leading-5">
                اگر اعتبار تمام شود، سرویس چت هوشمند و OCR تصاویر قطع خواهد شد. با دکمه «شارژ مجدد ۱۰۰ دلار» اعتبار را به حالت عادی بازگردانید.
              </p>
            )}
            <button
              onClick={() => {
                setRechargeError(null);
                setShowRechargeConfirm(true);
              }}
              className={`mt-2.5 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[10px] font-black transition-all cursor-pointer ${
                isCritical ? 'bg-white text-rose-700 hover:bg-rose-50' : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
              id="btn-recharge-credit-banner"
            >
              <Wallet className="w-3.5 h-3.5" />
              شارژ مجدد ۱۰۰ دلار
            </button>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-px bg-slate-200/50 border-t border-slate-200/50">
        <div className="bg-white/70 backdrop-blur p-3 text-center">
          <div className="text-[10px] font-black text-slate-400">کل درخواست‌ها</div>
          <div className="mt-1 text-sm font-black font-mono text-slate-800">{toPersianDigits(credit.requestCount)}</div>
        </div>
        <div className="bg-white/70 backdrop-blur p-3 text-center">
          <div className="text-[10px] font-black text-slate-400">توکن ورودی</div>
          <div className="mt-1 text-sm font-black font-mono text-slate-800">{credit.totalInputTokens.toLocaleString('fa-IR')}</div>
        </div>
        <div className="bg-white/70 backdrop-blur p-3 text-center">
          <div className="text-[10px] font-black text-slate-400">توکن خروجی</div>
          <div className="mt-1 text-sm font-black font-mono text-slate-800">{credit.totalOutputTokens.toLocaleString('fa-IR')}</div>
        </div>
      </div>

      {/* Model breakdown + last request */}
      {(credit.byModel && Object.keys(credit.byModel).length > 0) && (
        <div className="bg-white p-4 border-t border-slate-100">
          <h5 className="text-[11px] font-black text-slate-600 mb-2 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-indigo-500" />
            تفکیک مصرف بر اساس مدل
          </h5>
          <div className="space-y-1.5">
            {Object.entries(credit.byModel).map(([model, stats]) => (
              <div key={model} className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-black text-slate-700 truncate" dir="ltr">
                    {model}
                  </div>
                  <div className="text-[9px] font-bold text-slate-400">
                    {stats.count} درخواست • {stats.inputTokens + stats.outputTokens} توکن
                  </div>
                </div>
                <div className="shrink-0 text-[11px] font-black font-mono text-slate-800" dir="ltr">
                  ${stats.cost.toFixed(4)}
                </div>
              </div>
            ))}
          </div>

          {credit.lastRequest && (
            <div className="mt-3 rounded-lg bg-indigo-50 border border-indigo-100 p-2.5">
              <div className="text-[10px] font-black text-indigo-700">آخرین درخواست:</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold text-indigo-600 font-mono" dir="ltr">
                <span>{credit.lastRequest.model}</span>
                <span>in: {credit.lastRequest.inputTokens}</span>
                <span>out: {credit.lastRequest.outputTokens}</span>
                <span>${credit.lastRequest.cost.toFixed(5)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* لاگ هر درخواست — مدل، توکن ورودی/خروجی و هزینه کسرشده به دلار */}
      {recentLogs.length > 0 && (
        <div className="bg-white p-4 border-t border-slate-100">
          <h5 className="text-[11px] font-black text-slate-600 mb-2 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5 text-slate-500" />
            لاگ آخرین درخواست‌ها و شارژها
            <span className="mr-auto rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-black text-slate-500">
              {toPersianDigits(recentLogs.length)} ردیف
            </span>
          </h5>
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
            {recentLogs.map((log, index) => {
              const isRecharge = log.kind === 'recharge';
              return (
                <div
                  key={`${log.at}-${index}`}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                    isRecharge ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'
                  }`}
                >
                  {isRecharge ? (
                    <Wallet className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <Zap className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {isRecharge ? (
                        <span className="text-[10px] font-black text-emerald-700">
                          🔋 شارژ مجدد ${log.amount?.toFixed(2) ?? ''}
                        </span>
                      ) : (
                        <>
                          <span className="text-[10px] font-black text-slate-700 truncate" dir="ltr">
                            {log.model}
                          </span>
                          {log.isFallback && (
                            <span className="rounded-md bg-amber-100 border border-amber-200 px-1.5 py-0.5 text-[8px] font-black text-amber-700">
                              fallback
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {!isRecharge && (
                      <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-[9px] font-bold text-slate-400 font-mono" dir="ltr">
                        <span>in: {log.inputTokens?.toLocaleString('en-US')}</span>
                        <span>out: {log.outputTokens?.toLocaleString('en-US')}</span>
                        <span>cost: ${(log.cost ?? 0).toFixed(5)}</span>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-left">
                    <div className="text-[9px] font-bold text-slate-400">{formatLogTime(log.at)}</div>
                    <div className="text-[9px] font-black font-mono text-slate-600" dir="ltr">
                      ${log.remaining.toFixed(2)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer hint */}
      <div className="bg-slate-50 border-t border-slate-100 px-4 py-2.5 flex items-center gap-2">
        <CreditCard className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-[10px] font-bold text-slate-500 leading-5">
          متن → <b dir="ltr">deepseek/deepseek-chat</b> ($0.27/$1.10) | تصویر → <b dir="ltr">openai/gpt-4o-mini</b> ($0.15/$0.60) با fallback به <b dir="ltr">gpt-4o</b> برای تصاویر شلوغ
        </span>
      </div>

    {/* مودال تأیید شارژ مجدد — خارج از div اصلی تا position:fixed تحت تأثیر overflow/transform اجداد نباشد */}
    <RechargeConfirmModal
      isOpen={showRechargeConfirm}
      isRecharging={isRecharging}
      onConfirm={() => void performRecharge()}
      onCancel={() => {
        if (!isRecharging) {
          setShowRechargeConfirm(false);
          setRechargeError(null);
        }
      }}
    />
    </div>
    </>
  );
}

// Hook برای استفاده آسان در صفحات سرپرستار
export function useAiCredit() {
  const [credit, setCredit] = React.useState<AiCreditData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchCredit = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/credit', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطا در دریافت اعتبار');
      setCredit(data.credit as AiCreditData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // بارگذاری اولیه: به‌روزرسانی state فقط پس از await انجام می‌شود (بدون setState هم‌زمان در بدنهٔ effect)
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/ai/credit', { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || 'خطا در دریافت اعتبار');
        setCredit(data.credit as AiCreditData);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    const interval = setInterval(() => void fetchCredit(), 60_000); // هر دقیقه به‌روزرسانی
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fetchCredit]);

  return { credit, isLoading, error, refresh: fetchCredit };
}

export default AiCreditPanel;
