/**
 * lib/ai/credit.ts
 * ---------------------------------------------------------------------------
 * سیستم مدیریت اعتبار ۱۰۰ دلاری سرویس AI (بر پایه OpenRouter)
 *
 * الزامات:
 *   - اعتبار اولیه ۱۰۰ دلار
 *   - ردیابی مصرف توکن‌ها در هر درخواست (Input & Output)
 *   - محاسبه هزینه بر اساس قیمت هر توکن مدل و کسر از اعتبار باقی‌مانده
 *   - به‌روزرسانی اعتبار در state سیستم (و ذخیره در فایل برای پایداری بین restarts)
 *   - هشدار زرد < 15 دلار و قرمز < 5 دلار در UI سرپرستار
 *
 * قیمت‌گذاری (بر اساس Bluesminds / دلار به ازای هر ۱M توکن):
 *   - deepseek-chat (یا deepseek/deepseek-chat) : input $0.27 / output $1.10
 *   - deepseek-v3 (یا deepseek/deepseek-v3)      : همان قیمت deepseek-chat
 *   - gpt-4o-mini (یا openai/gpt-4o-mini)       : input $0.15 / output $0.60
 *   - gpt-4o (یا openai/gpt-4o)                  : input $2.50 / output $10.00
 *
 * قیمت‌ها از env قابل override هستند جهت انعطاف.
 */

export const INITIAL_CREDIT_USD = Number(process.env.AI_INITIAL_CREDIT_USD) || 100;

export const WARNING_THRESHOLD_USD = Number(process.env.AI_CREDIT_WARNING_THRESHOLD) || 15;
export const CRITICAL_THRESHOLD_USD = Number(process.env.AI_CREDIT_CRITICAL_THRESHOLD) || 5;

/** سقف نگهداری لاگ درخواست‌ها در state — قدیمی‌ترها خودکار حذف می‌شوند. */
export const MAX_CREDIT_LOGS = 200;

export type CreditStatusLevel = 'ok' | 'warning' | 'critical' | 'depleted';

/**
 * یک ردیف لاگ مصرف/شارژ اعتبار.
 * برای هر درخواست API، شامل: مدل استفاده‌شده، تعداد توکن ورودی/خروجی و هزینه کسرشده به دلار.
 * برای شارژ مجدد، فیلدهای kind/amount پر می‌شوند.
 */
export interface CreditLogEntry {
  /** زمان ISO ثبت لاگ */
  at: string;
  kind: 'request' | 'recharge';
  /** مدل استفاده‌شده (برای kind=request) */
  model?: string;
  /** تعداد توکن ورودی (prompt_tokens) */
  inputTokens?: number;
  /** تعداد توکن خروجی (completion_tokens) */
  outputTokens?: number;
  /** هزینه کسرشده به دلار (برای kind=request) */
  cost?: number;
  /** مبلغ شارژ به دلار (برای kind=recharge) */
  amount?: number;
  /** اعتبار باقی‌مانده پس از این عملیات */
  remaining: number;
  /** آیا این درخواست با مدل fallback پردازش شده است؟ */
  isFallback?: boolean;
}

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'deepseek-chat': {
    inputPerMillion: Number(process.env.PRICING_DEEPSEEK_INPUT) || 0.27,
    outputPerMillion: Number(process.env.PRICING_DEEPSEEK_OUTPUT) || 1.10,
  },
  'deepseek-v3': {
    inputPerMillion: Number(process.env.PRICING_DEEPSEEK_INPUT) || 0.27,
    outputPerMillion: Number(process.env.PRICING_DEEPSEEK_OUTPUT) || 1.10,
  },
  'deepseek/deepseek-chat': {
    inputPerMillion: Number(process.env.PRICING_DEEPSEEK_INPUT) || 0.27,
    outputPerMillion: Number(process.env.PRICING_DEEPSEEK_OUTPUT) || 1.10,
  },
  'deepseek/deepseek-v3': {
    inputPerMillion: Number(process.env.PRICING_DEEPSEEK_INPUT) || 0.27,
    outputPerMillion: Number(process.env.PRICING_DEEPSEEK_OUTPUT) || 1.10,
  },
  'deepseek/deepseek-chat-v3-0324': {
    inputPerMillion: 0.27,
    outputPerMillion: 1.10,
  },
  'gpt-4o-mini': {
    inputPerMillion: Number(process.env.PRICING_GPT4O_MINI_INPUT) || 0.15,
    outputPerMillion: Number(process.env.PRICING_GPT4O_MINI_OUTPUT) || 0.60,
  },
  'gpt-4o': {
    inputPerMillion: Number(process.env.PRICING_GPT4O_INPUT) || 2.5,
    outputPerMillion: Number(process.env.PRICING_GPT4O_OUTPUT) || 10.0,
  },
  'openai/gpt-4o-mini': {
    inputPerMillion: Number(process.env.PRICING_GPT4O_MINI_INPUT) || 0.15,
    outputPerMillion: Number(process.env.PRICING_GPT4O_MINI_OUTPUT) || 0.60,
  },
  'openai/gpt-4o': {
    inputPerMillion: Number(process.env.PRICING_GPT4O_INPUT) || 2.5,
    outputPerMillion: Number(process.env.PRICING_GPT4O_OUTPUT) || 10.0,
  },
  // Fallback for unknown models: approximate to gpt-4o-mini pricing
  'default': {
    inputPerMillion: 0.30,
    outputPerMillion: 1.20,
  },
};

function getPricingForModel(modelId: string): ModelPricing {
  const normalized = modelId.toLowerCase().trim();
  if (MODEL_PRICING[normalized]) return MODEL_PRICING[normalized];
  // try includes
  for (const key of Object.keys(MODEL_PRICING)) {
    if (key === 'default') continue;
    if (normalized.includes(key) || key.includes(normalized)) {
      return MODEL_PRICING[key];
    }
  }
  return MODEL_PRICING['default'];
}

export function calculateCostUSD(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getPricingForModel(model);
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}

export interface CreditState {
  initial: number;
  remaining: number;
  totalSpent: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  requestCount: number;
  lastUpdated: string;
  lastRequest?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    at: string;
  };
  /** لاگ آخرین درخواست‌ها/شارژها (جدیدترین‌ها در انتها) — سقف MAX_CREDIT_LOGS */
  logs: CreditLogEntry[];
  // per-model breakdown
  byModel: Record<string, { inputTokens: number; outputTokens: number; cost: number; count: number }>;
}

function getInitialState(): CreditState {
  return {
    initial: INITIAL_CREDIT_USD,
    remaining: INITIAL_CREDIT_USD,
    totalSpent: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    requestCount: 0,
    lastUpdated: new Date().toISOString(),
    logs: [],
    byModel: {},
  };
}

// Singleton in-memory state (survives across hot reloads via globalThis)
const GLOBAL_KEY = '__NURSEPLAN_AI_CREDIT_STATE__';
type GlobalWithCredit = typeof globalThis & { [k: string]: CreditState | undefined };

function getGlobalState(): CreditState {
  const g = globalThis as GlobalWithCredit;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = getInitialState();
  }
  return g[GLOBAL_KEY] as CreditState;
}

function setGlobalState(state: CreditState) {
  const g = globalThis as GlobalWithCredit;
  g[GLOBAL_KEY] = state;
}

// Optional file persistence for local/dev (best-effort, ignored in serverless if fails)
import fs from 'fs';
import path from 'path';

const CREDIT_FILE_PATHS = [
  path.join(process.cwd(), 'data', 'ai-credit.json'),
  path.join(process.cwd(), '.tmp', 'ai-credit.json'),
  path.join('/tmp', 'nurseplan-ai-credit.json'),
];

function tryLoadFromFile(): CreditState | null {
  for (const filePath of CREDIT_FILE_PATHS) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as CreditState;
        if (typeof parsed.remaining === 'number' && typeof parsed.initial === 'number') {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function trySaveToFile(state: CreditState) {
  for (const filePath of CREDIT_FILE_PATHS) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
      return; // saved to first writable
    } catch {
      // try next
    }
  }
}

// Initialize from file if available (only once per process)
let initializedFromFile = false;
function ensureInitialized() {
  if (initializedFromFile) return;
  initializedFromFile = true;
  const loaded = tryLoadFromFile();
  if (loaded) {
    // مهاجرت state های قدیمی: اگر فیلد logs وجود نداشت، خالی مقداردهی می‌شود.
    if (!Array.isArray((loaded as Partial<CreditState>).logs)) {
      (loaded as Partial<CreditState>).logs = [];
    }
    const current = getGlobalState();
    // Only adopt if loaded is newer or has more spent (avoid overwriting newer in-memory state with old file)
    // For simplicity: if file has less remaining than memory, adopt file (means costs were tracked)
    // Actually we want max accuracy: take file if its totalSpent > current totalSpent
    if (loaded.totalSpent > current.totalSpent || loaded.requestCount > current.requestCount) {
      setGlobalState(loaded);
    }
  }
}

export function getCreditState(): CreditState {
  ensureInitialized();
  return { ...getGlobalState() };
}

export function getCreditStatusLevel(remaining: number): CreditStatusLevel {
  if (remaining <= 0) return 'depleted';
  if (remaining < CRITICAL_THRESHOLD_USD) return 'critical';
  if (remaining < WARNING_THRESHOLD_USD) return 'warning';
  return 'ok';
}

export interface UsageInput {
  model: string;
  inputTokens: number;
  outputTokens: number;
  // optional: whether this was fallback model used
  isFallback?: boolean;
}

export interface DeductResult {
  cost: number;
  remaining: number;
  status: CreditStatusLevel;
  state: CreditState;
}

/**
 * محاسبه هزینه و کسر از اعتبار
 */
export function deductCredit(usage: UsageInput): DeductResult {
  ensureInitialized();
  const state = getGlobalState();

  const inputTokens = Math.max(0, Math.floor(usage.inputTokens || 0));
  const outputTokens = Math.max(0, Math.floor(usage.outputTokens || 0));
  const cost = calculateCostUSD(usage.model, inputTokens, outputTokens);

  state.totalInputTokens += inputTokens;
  state.totalOutputTokens += outputTokens;
  state.totalSpent += cost;
  state.remaining = Math.max(0, state.initial - state.totalSpent);
  state.requestCount += 1;
  state.lastUpdated = new Date().toISOString();
  state.lastRequest = {
    model: usage.model,
    inputTokens,
    outputTokens,
    cost,
    at: state.lastUpdated,
  };

  if (!state.byModel[usage.model]) {
    state.byModel[usage.model] = { inputTokens: 0, outputTokens: 0, cost: 0, count: 0 };
  }
  state.byModel[usage.model].inputTokens += inputTokens;
  state.byModel[usage.model].outputTokens += outputTokens;
  state.byModel[usage.model].cost += cost;
  state.byModel[usage.model].count += 1;

  // لاگ هر درخواست: توکن ورودی، توکن خروجی، مدل استفاده‌شده و هزینه کسرشده به دلار
  const logEntry: CreditLogEntry = {
    at: state.lastUpdated,
    kind: 'request',
    model: usage.model,
    inputTokens,
    outputTokens,
    cost,
    remaining: state.remaining,
    ...(usage.isFallback ? { isFallback: true } : {}),
  };
  state.logs.push(logEntry);
  if (state.logs.length > MAX_CREDIT_LOGS) {
    state.logs = state.logs.slice(-MAX_CREDIT_LOGS);
  }

  setGlobalState(state);
  trySaveToFile(state);

  const status = getCreditStatusLevel(state.remaining);

  // Log for observability
  console.log(
    `[ai-credit] model=${usage.model} in=${inputTokens} out=${outputTokens} cost=$${cost.toFixed(6)} remaining=$${state.remaining.toFixed(4)} status=${status}${usage.isFallback ? ' (fallback)' : ''}`
  );

  if (status === 'warning') {
    console.warn(`[ai-credit] ⚠️ اعتبار API به پایان خود نزدیک است (باقی‌مانده: $${state.remaining.toFixed(2)}). لطفاً جهت جلوگیری از قطعی سرویس نسبت به شارژ اقدام کنید.`);
  } else if (status === 'critical' || status === 'depleted') {
    console.error(`[ai-credit] 🚨 اعتبار API بحرانی است (باقی‌مانده: $${state.remaining.toFixed(2)}). سرویس در آستانه قطعی است!`);
  }

  return {
    cost,
    remaining: state.remaining,
    status,
    state: { ...state },
  };
}

/**
 * برای تست‌ها و ریست دستی — کل state را از صفر بازسازی می‌کند (بدون ثبت لاگ).
 * برای شارژ مجدد واقعی از `rechargeCredit` استفاده کنید تا لاگ شارژ ثبت شود.
 */
export function resetCredit(toInitial: number = INITIAL_CREDIT_USD): CreditState {
  const state = getInitialState();
  state.initial = toInitial;
  state.remaining = toInitial;
  setGlobalState(state);
  trySaveToFile(state);
  return { ...state };
}

/**
 * شارژ مجدد اعتبار (Recharge).
 *
 * اعتبار باقی‌مانده را دقیقاً به `amount` (پیش‌فرض ۱۰۰ دلار) بازمی‌گرداند.
 * از آنجا که remaining پس از شارژ بالای هر دو آستانه (۱۵ و ۵ دلار) قرار می‌گیرد،
 * وضعیت بنرهای هشدار زرد/قرمز به‌صورت خودکار به «عادی» (ok) برمی‌گردد.
 *
 * برخلاف `resetCredit`، آمار مصرف (totalSpent، byModel و …) حفظ می‌شود و فقط
 * سقف اعتبار (initial) طوری تنظیم می‌شود که remaining = amount باشد.
 */
export function rechargeCredit(amount: number = INITIAL_CREDIT_USD): CreditState {
  ensureInitialized();
  const state = getGlobalState();

  const target = Math.round(Math.max(0, Number.isFinite(Number(amount)) ? Number(amount) : INITIAL_CREDIT_USD) * 100) / 100;
  const delta = Math.round((target - state.remaining) * 100) / 100;

  if (delta !== 0) {
    // ثابت نگه‌داشتن رابطهٔ remaining = initial - totalSpent
    state.initial = Math.round((state.initial + delta) * 100) / 100;
  }
  state.remaining = target;
  state.lastUpdated = new Date().toISOString();
  state.logs.push({
    at: state.lastUpdated,
    kind: 'recharge',
    amount: target,
    remaining: target,
  });
  if (state.logs.length > MAX_CREDIT_LOGS) {
    state.logs = state.logs.slice(-MAX_CREDIT_LOGS);
  }

  setGlobalState(state);
  trySaveToFile(state);

  const status = getCreditStatusLevel(state.remaining);
  console.log(
    `[ai-credit] 🔋 recharge -> remaining=$${state.remaining.toFixed(2)} / initial=$${state.initial.toFixed(2)} status=${status} (هشدارها به حالت عادی بازگشتند)`
  );

  return { ...state };
}

export function addCredit(amount: number): CreditState {
  ensureInitialized();
  const state = getGlobalState();
  state.initial += amount;
  state.remaining += amount;
  state.lastUpdated = new Date().toISOString();
  state.logs.push({
    at: state.lastUpdated,
    kind: 'recharge',
    amount,
    remaining: state.remaining,
  });
  if (state.logs.length > MAX_CREDIT_LOGS) {
    state.logs = state.logs.slice(-MAX_CREDIT_LOGS);
  }
  setGlobalState(state);
  trySaveToFile(state);
  return { ...state };
}

/**
 * وضعیت برای نمایش در UI
 */
export interface CreditDisplayInfo {
  initial: number;
  remaining: number;
  spent: number;
  percentRemaining: number;
  status: CreditStatusLevel;
  warningMessage?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  requestCount: number;
  byModel: CreditState['byModel'];
  lastRequest?: CreditState['lastRequest'];
  /** لاگ آخرین درخواست‌ها/شارژها — جدیدترین‌ها اول */
  logs: CreditLogEntry[];
}

export function getCreditDisplayInfo(): CreditDisplayInfo {
  const state = getCreditState();
  const percentRemaining = state.initial > 0 ? (state.remaining / state.initial) * 100 : 0;
  const status = getCreditStatusLevel(state.remaining);

  let warningMessage: string | undefined;
  if (status === 'warning') {
    warningMessage = `⚠️ اعتبار API به پایان خود نزدیک است (باقی‌مانده: $${state.remaining.toFixed(2)}). لطفاً جهت جلوگیری از قطعی سرویس نسبت به شارژ اقدام کنید.`;
  } else if (status === 'critical' || status === 'depleted') {
    warningMessage = `🚨 اعتبار API بحرانی است (باقی‌مانده: $${state.remaining.toFixed(2)}). سرویس به زودی قطع خواهد شد! لطفاً فوراً نسبت به شارژ اقدام کنید.`;
  }

  return {
    initial: state.initial,
    remaining: state.remaining,
    spent: state.totalSpent,
    percentRemaining,
    status,
    warningMessage,
    totalInputTokens: state.totalInputTokens,
    totalOutputTokens: state.totalOutputTokens,
    requestCount: state.requestCount,
    byModel: state.byModel,
    lastRequest: state.lastRequest,
    logs: state.logs.slice(-50).reverse(),
  };
}

/**
 * اجرای یک اکشن اعتبار (recharge | reset | add) به‌صورت خالص — برای Route و تست.
 *
 * بدنهٔ درخواست: { action: "recharge", amount: 100 }
 */
export interface CreditActionResult {
  ok: boolean;
  message?: string;
  error?: string;
  statusCode: number;
  credit: CreditDisplayInfo;
}

export function applyCreditAction(action: string, amount: unknown): CreditActionResult {
  const numericAmount = Number(amount);

  if (action === 'recharge') {
    const target = Number.isFinite(numericAmount) && numericAmount > 0 ? numericAmount : INITIAL_CREDIT_USD;
    const state = rechargeCredit(target);
    return {
      ok: true,
      statusCode: 200,
      message: `اعتبار با موفقیت به $${state.remaining.toFixed(2)} شارژ مجدد شد؛ وضعیت هشدار به حالت عادی بازگشت.`,
      credit: getCreditDisplayInfo(),
    };
  }

  if (action === 'reset') {
    const newAmount = Number.isFinite(numericAmount) && numericAmount > 0 ? numericAmount : INITIAL_CREDIT_USD;
    resetCredit(newAmount);
    return {
      ok: true,
      statusCode: 200,
      message: `اعتبار به $${newAmount.toFixed(2)} ریست شد.`,
      credit: getCreditDisplayInfo(),
    };
  }

  if (action === 'add') {
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return { ok: false, error: 'مبلغ شارژ معتبر نیست.', statusCode: 400, credit: getCreditDisplayInfo() };
    }
    addCredit(numericAmount);
    return {
      ok: true,
      statusCode: 200,
      message: `$${numericAmount.toFixed(2)} به اعتبار اضافه شد.`,
      credit: getCreditDisplayInfo(),
    };
  }

  return {
    ok: false,
    error: 'action نامعتبر است (recharge | reset | add).',
    statusCode: 400,
    credit: getCreditDisplayInfo(),
  };
}
