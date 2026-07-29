import { Type } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { generateContentWithRetry, getGeminiClient, ModelBusyError } from "@/lib/gemini";

type ChatRole = "assistant" | "user";

type IncomingChatMessage = {
  role: ChatRole;
  content: string;
};

const VALID_REQUEST_TYPES = new Set(["shift", "OFF", "leave", "pattern", "avoid_shift"]);
const VALID_SHIFTS = new Set(["M", "E", "N", "ME", "EN", "MN", "MEN", "OFF", "L"]);
const VALID_SCOPES = new Set(["all", "even", "odd", "weekly_even", "weekly_odd", "custom_days", "range"]);
const VALID_OFF_HARDNESS = new Set(["hard", "soft"]);

function normalizeDayList(value: unknown, totalDays: number): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const days = Array.from(new Set(
    value
      .map(item => Number(item))
      .filter(day => Number.isInteger(day) && day >= 1 && day <= totalDays)
  )).sort((a, b) => a - b);
  return days.length > 0 ? days : undefined;
}

function normalizeRequest(raw: any, totalDays: number) {
  const requestType = VALID_REQUEST_TYPES.has(raw?.requestType) ? raw.requestType : undefined;
  if (!requestType) return null;

  const scope = VALID_SCOPES.has(raw?.scope) ? raw.scope : "custom_days";
  const preferredShift = VALID_SHIFTS.has(raw?.preferredShift) ? raw.preferredShift : undefined;
  const selectedDays = normalizeDayList(raw?.selectedDays, totalDays);
  const patternSteps = Array.isArray(raw?.patternSteps)
    ? raw.patternSteps
        .map((step: unknown) => String(step || "").trim().toUpperCase())
        .filter((step: string) => VALID_SHIFTS.has(step))
    : undefined;

  return {
    requestType,
    preferredShift: requestType === "OFF"
      ? "OFF"
      : requestType === "leave"
        ? "L"
        : preferredShift,
    patternSteps: patternSteps && patternSteps.length > 0 ? patternSteps : undefined,
    isEssential: !!raw?.isEssential,
    offHardness: requestType === "OFF"
      ? (VALID_OFF_HARDNESS.has(raw?.offHardness) ? raw.offHardness : "hard")
      : undefined,
    scope,
    startDate: typeof raw?.startDate === "string" ? raw.startDate : undefined,
    endDate: typeof raw?.endDate === "string" ? raw.endDate : undefined,
    selectedDays: scope === "custom_days" ? selectedDays : undefined,
    description: typeof raw?.description === "string" ? raw.description : undefined,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = Array.isArray(body.messages) ? body.messages as IncomingChatMessage[] : [];
    const year = Number(body.year);
    const month = Number(body.month);
    const personnel = body.personnel || {};
    const calendarDays = Array.isArray(body.calendarDays) ? body.calendarDays : [];
    const existingRequests = Array.isArray(body.existingRequests) ? body.existingRequests : [];
    const scheduleHistory = Array.isArray(body.scheduleHistory) ? body.scheduleHistory : [];

    const lastUserMessage = [...messages].reverse().find(message => message.role === "user")?.content?.trim();
    if (!lastUserMessage) {
      return NextResponse.json({ error: "متن پیام نمی‌تواند خالی باشد." }, { status: 400 });
    }
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      return NextResponse.json({ error: "ماه و سال درخواست معتبر نیست." }, { status: 400 });
    }

    const totalDays = calendarDays.length || 31;
    const ai = getGeminiClient();

    const systemPrompt = `
You are a warm Persian chat assistant running on Google Gemini inside a hospital nursing scheduling app.
Speak conversational Persian, friendly and concise. The user is a nurse/personnel. If a first name is provided, greet and refer to them naturally by first name.

Your goal is to turn natural Persian scheduling conversations into clean structured shift requests.
BE DECISIVE — never interrogate the user with repeated questions.
- If the request is understandable with a reasonable interpretation, produce it NOW with status="ready" and briefly mention your assumption in reply/summary (e.g. «منظورت ... بود؟»).
- Ask at most ONE short clarifying question, and only when a truly critical piece is missing (e.g. no days/dates at all, or a shift that cannot be mapped even with the slang rules below). In that case set status="clarification" with an empty requests array.
- Always answer the actionable part of a message first; never block everything just because one detail is fuzzy.
If the user is venting, tired, or sharing personal context, respond empathetically and suggest practical request wording; only create requests when the user clearly asks for them.
Never promise that requests will definitely be approved. Say they will be registered and the final schedule depends on ward coverage, crowding, limits, and head-nurse decisions.

PERSIAN SHIFT SLANG (CRITICAL — map these instantly, never ask what they mean):
- «عصر و شب» / «عصر-شب» / «عصرشب» = EN
- «لانگ» / «لانگ شیفت» / «شیفت لانگ» = ME
- «۲۴» / «24» / «۲۴ ساعته» / «24 ساعته» / «شیفت ۲۴» = MEN
- «صبح تک» = M، «عصر تک» = E، «شب تک» = N (شیفت تکی همان بازه)

MULTI-REQUEST ANALYSIS (CRITICAL):
- A single message usually contains SEVERAL requests. Extract ALL of them into separate request items — never process just the first one.
- Example: «دهم و دوازدهم آف، بیستم شب تک، پنجشنبه‌ها لانگ» → three requests: OFF on days [10,12], shift N on day [20], shift ME on Thursdays.
- All extracted items must appear together in the requests array so the user sees every request in the results panel at once.

SUPPORTED REQUEST STRUCTURE:
- requestType: "shift", "OFF", "leave", "pattern", "avoid_shift"
- preferredShift for shift/avoid_shift: "M", "E", "N", "ME", "EN", "MN", "MEN"
- preferredShift for OFF: "OFF"
- preferredShift for leave: "L"
- patternSteps for pattern requests: array of shift codes such as ["ME", "OFF"] or ["EN", "OFF", "OFF"]
- scope: "all", "even", "odd", "weekly_even", "weekly_odd", "custom_days", "range"
- weekly_even means Saturday/Monday/Wednesday only; weekly_odd means Sunday/Tuesday/Thursday only; Friday is excluded from weekly_even/weekly_odd.
- selectedDays is preferred for specific dates, date ranges, and weekdays after resolving against the supplied calendar.
- isEssential=true only when the user clearly says اجباری، ضروری، خیلی مهم، حتماً، قطعی, or equivalent.
- offHardness: for OFF, use "hard" for قطعی/اجباری/مرخصی‌مانند, "soft" for ترجیحاً/اگه شد.

UNDERSTANDING REQUIREMENTS:
- Detect dates, weekdays, shift types, OFF, leave, avoidance/non-presence, preferences, constraints, mandatory requests, multiple requests in one text.
- If the user says they work shifts in another hospital and wants the opposite here, convert the outside-hospital shifts into avoid_shift requests for this hospital when dates and shift types are clear.
- Use scheduleHistory to infer likely routine/pattern only as a suggestion in reply. Do not fabricate a final structured pattern unless the user confirms or clearly asks for it.
- Use existingRequests to warn if the new request seems excessive or conflicting, but do not refuse; explain no guarantee.

OUTPUT RULES:
Return only JSON matching the schema.
status meanings:
- "ready": clean requests are extracted and ready for user confirmation.
- "clarification": ask AT MOST one question because a critical detail (dates/shift) is genuinely missing; requests must be [].
- "chat": supportive or advisory answer with no final requests yet.
reply should be what the chat bubble says to the user.
summary should be a compact Persian recap starting with or suitable after "منظور شما این است؟" when status="ready".

SYNC RULE (CRITICAL — reply/summary must match requests EXACTLY):
- AFTER building the requests array, write reply and summary FROM that exact array — treat the array as the only source of truth.
- Mention EVERY item of requests in reply/summary, one short clause per item (e.g. «صبح تک در روزهای غیرتعطیل»، «۲۴ ساعته برای ۱۳ مرداد»، «آف در مابقی تعطیلات»).
- NEVER announce a request, pattern or shift in reply/summary that is NOT present in the requests array. If something cannot be expressed as a structured item, leave it out of the spoken summary too (you may mention it only as a caveat in warnings).
- If you produce 3 items, describe 3 items; if 1, describe 1. What the assistant says must equal what the user sees in the analysis panel.
`;

    const context = {
      targetMonth: { year, month, totalDays },
      personnel: {
        firstName: personnel.firstName,
        lastName: personnel.lastName,
        jobGroup: personnel.jobGroup,
        workRoutine: personnel.workRoutine,
      },
      calendarDays,
      existingRequests,
      scheduleHistory,
      conversation: messages.map(message => ({
        role: message.role,
        content: String(message.content || "").slice(0, 2000),
      })),
    };

    const response = await generateContentWithRetry(ai, {
      contents: `CONTEXT_JSON:\n${JSON.stringify(context)}\n\nAnalyze the conversation and respond with the requested JSON object.`,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING, enum: ["ready", "clarification", "chat"] },
            reply: { type: Type.STRING },
            summary: { type: Type.STRING },
            warnings: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            questions: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            requests: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  requestType: { type: Type.STRING, enum: ["shift", "OFF", "leave", "pattern", "avoid_shift"] },
                  preferredShift: { type: Type.STRING, enum: ["M", "E", "N", "ME", "EN", "MN", "MEN", "OFF", "L"] },
                  patternSteps: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING, enum: ["M", "E", "N", "ME", "EN", "MN", "MEN", "OFF", "L"] }
                  },
                  isEssential: { type: Type.BOOLEAN },
                  offHardness: { type: Type.STRING, enum: ["hard", "soft"] },
                  scope: { type: Type.STRING, enum: ["all", "even", "odd", "weekly_even", "weekly_odd", "custom_days", "range"] },
                  startDate: { type: Type.STRING },
                  endDate: { type: Type.STRING },
                  selectedDays: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER }
                  },
                  description: { type: Type.STRING }
                },
                required: ["requestType", "scope"]
              }
            }
          },
          required: ["status", "reply", "requests"]
        }
      }
    });

    const parsedData = JSON.parse(response.text || "{}");
    const status = ["ready", "clarification", "chat"].includes(parsedData.status) ? parsedData.status : "chat";
    const normalizedRequests = status === "ready"
      ? (Array.isArray(parsedData.requests) ? parsedData.requests : [])
          .map((item: any) => normalizeRequest(item, totalDays))
          .filter(Boolean)
      : [];

    return NextResponse.json({
      status,
      reply: typeof parsedData.reply === "string" ? parsedData.reply : "پیامت را گرفتم؛ برای ثبت تمیز درخواست، کمی دقیق‌تر بگو لطفاً.",
      summary: typeof parsedData.summary === "string" ? parsedData.summary : "",
      warnings: Array.isArray(parsedData.warnings) ? parsedData.warnings.filter((item: unknown) => typeof item === "string") : [],
      questions: Array.isArray(parsedData.questions) ? parsedData.questions.filter((item: unknown) => typeof item === "string") : [],
      requests: normalizedRequests,
    });
  } catch (error) {
    if (error instanceof ModelBusyError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("Error in Gemini request chat:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "خطای ناشناخته در گفت‌وگوی هوشمند" },
      { status: 500 }
    );
  }
}
