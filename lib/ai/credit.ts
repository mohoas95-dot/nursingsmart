/**
 * lib/ai/credit.ts
 * ---------------------------------------------------------------------------
 * سیستم اعتبار ۱۰۰ دلاری در معماری ۲۰۲۶ کاملاً حذف شده است (طبق درخواست کارفرما).
 * این فایل فقط برای جلوگیری از شکست importهای قدیمی، استاب خالی برمی‌گرداند.
 * هیچ منطق محاسبه هزینه‌ای وجود ندارد چون Gemini با کلیدهای رایگان/پرداختی
 * مستقیم کار می‌کند و مدیریت هزینه در کنسول گوگل انجام می‌شود.
 */

export const INITIAL_CREDIT_USD = 0;
export const WARNING_THRESHOLD_USD = 0;
export const CRITICAL_THRESHOLD_USD = 0;
export const MAX_CREDIT_LOGS = 0;
export type CreditStatusLevel = 'ok' | 'warning' | 'critical' | 'depleted';
export interface CreditLogEntry { at: string; kind: 'request' | 'recharge'; remaining: number; }
export interface ModelPricing { inputPerMillion: number; outputPerMillion: number; }
export const MODEL_PRICING: Record<string, ModelPricing> = {};
export function getPricingForModel() { return { inputPerMillion: 0, outputPerMillion: 0 }; }
export function calculateCostUSD() { return 0; }
export interface CreditState { initial: number; remaining: number; totalSpent: number; totalInputTokens: number; totalOutputTokens: number; requestCount: number; lastUpdated: string; logs: any[]; byModel: Record<string, any>; }
function emptyState(): CreditState {
  return { initial: 0, remaining: 0, totalSpent: 0, totalInputTokens: 0, totalOutputTokens: 0, requestCount: 0, lastUpdated: new Date().toISOString(), logs: [], byModel: {} };
}
export function getCreditState(): CreditState { return emptyState(); }
export function getCreditStatusLevel() { return 'ok' as CreditStatusLevel; }
export interface UsageInput { model: string; inputTokens: number; outputTokens: number; isFallback?: boolean; }
export interface DeductResult { cost: number; remaining: number; status: CreditStatusLevel; state: CreditState; }
export function deductCredit(): DeductResult { return { cost: 0, remaining: 0, status: 'ok', state: emptyState() }; }
export function resetCredit() { return emptyState(); }
export function rechargeCredit() { return emptyState(); }
export function addCredit() { return emptyState(); }
export interface CreditDisplayInfo { initial: number; remaining: number; spent: number; percentRemaining: number; status: CreditStatusLevel; warningMessage?: string; totalInputTokens: number; totalOutputTokens: number; requestCount: number; byModel: any; lastRequest?: any; logs: any[]; }
export function getCreditDisplayInfo(): CreditDisplayInfo {
  return { initial: 0, remaining: 0, spent: 0, percentRemaining: 100, status: 'ok', totalInputTokens: 0, totalOutputTokens: 0, requestCount: 0, byModel: {}, logs: [] };
}
export interface CreditActionResult { ok: boolean; message?: string; error?: string; statusCode: number; credit: CreditDisplayInfo; }
export function applyCreditAction(): CreditActionResult {
  return { ok: false, error: 'سیستم اعتبار ۱۰۰ دلاری حذف شده است. هزینه در کنسول Gemini مدیریت می‌شود.', statusCode: 410, credit: getCreditDisplayInfo() };
}
