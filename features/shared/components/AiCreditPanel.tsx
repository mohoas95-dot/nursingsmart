'use client';

import React from 'react';

/**
 * AiCreditPanel — نسخه ۲۰۲۶ منسوخ شده
 *
 * سیستم اعتبار ۱۰۰ دلاری کاملاً حذف شده است.
 * این فایل فقط برای جلوگیری از شکست importهای قدیمی باقی مانده و هیچ چیزی render نمی‌کند.
 * لاگ مربوط به اعتبار ۱۰۰ دلاری در صفحه گزارشات به طور کلی حذف شده است.
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
  onRecharged?: (credit: AiCreditData) => void;
  className?: string;
}

export function RechargeConfirmModal() { return null; }

export function AiCreditPanel() {
  // حذف کامل UI اعتبار — طبق درخواست کارفرما لاگ ۱۰۰ دلاری در گزارشات حذف شود
  return null;
}

export function useAiCredit() {
  return { credit: null, isLoading: false, error: null, refresh: () => {} };
}

export default AiCreditPanel;
