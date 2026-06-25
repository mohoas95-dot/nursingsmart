import { GoogleGenAI, Type } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

// We initialize the client inside the route handler lazy-fashion to avoid crashing at module load if API key is not set.
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not defined in environment variables.");
  }
  return new GoogleGenAI({ apiKey });
}

export async function POST(req: NextRequest) {
  try {
    const { text, year, month } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "متن درخواست نمی‌تواند خالی باشد." }, { status: 400 });
    }

    const ai = getGeminiClient();

    const systemPrompt = `
You are an expert bilingual AI assistant for a Persian hospital nursing scheduling system.
Your job is to read a conversational scheduling request from a nurse (in Persian or English) and parse it into an array of structured request objects.

CONTEXT:
- The target Persian month is: Month number ${month} of Year ${year}.
- The weekdays and calendar dates refer to this specific month.

RULES FOR PARSING:
1. "M" = Morning (صبح), "E" = Afternoon (عصر), "N" = Night (شب), "ME" = Morning-Afternoon (عصر-صبح), "EN" = Afternoon-Night (شب-عصر), "MN" = Night-Morning (شب-صبح), "MEN" = Whole day (ترکیبی کل روز).
2. If request is NOT TO BE in a shift (e.g. "در تاریخ... شیفت... نباشم"), map:
   - requestType = "avoid_shift"
   - preferredShift = the shift to avoid (e.g., "M", "E", "N", "ME", "EN")
3. If request is to be assigned a shift (e.g. "در تاریخ... شیفت... باشم"), map:
   - requestType = "shift"
   - preferredShift = the desired shift (M, E, N, ME, EN, MN, MEN)
4. If request is strict Off/Day off (e.g. "آف باشم", "تعطیل باشم", "کشیک نباشم کل روز"), map:
   - requestType = "OFF"
   - preferredShift = "OFF"
5. If request is for annual leave (e.g. "مرخصی باشم", "استحقاقی"), map:
   - requestType = "leave"
   - preferredShift = "L"
6. Identify the calendar days correctly:
   - "۱۰ام" or "دهم" or "10" -> day 10
   - "شنبه‌ها" -> find Saturday days of the month or just use are of selectedDays.
   - If a range is mentioned e.g., "۱۲ام تا ۱۵ام" -> you can specify scope: "custom_days" and list the selectedDays as [12, 13, 14, 15] or scope: "range" with startDate and endDate. Using scope: "custom_days" is preferred and safest.
   - "روزهای زوج" -> scope: "even"
   - "روزهای فرد" -> scope: "odd"
   - "روزهای زوج هفته" (Saturday, Monday, Wednesday) -> scope: "weekly_even"
   - "روزهای فرد هفته" (Sunday, Tuesday, Thursday) -> scope: "weekly_odd"
   - "کل ماه" / "تمام روزها" -> scope: "all"
   - For specific singular or multiple days (e.g. "روزهای ۳ و ۷ و ۹") -> scope: "custom_days" and selectedDays: [3, 7, 9].

EXAMPLES:
- User: "روزهای ۱۲ و ۱۵ آف قطعی می‌خواهم و روز ۲۰ام شیفت شب باشم"
  Parsed Array:
  [
    { "requestType": "OFF", "preferredShift": "OFF", "scope": "custom_days", "selectedDays": [12, 15], "description": "آف قطعی در روزهای ۱۲ و ۱۵" },
    { "requestType": "shift", "preferredShift": "N", "scope": "custom_days", "selectedDays": [20], "description": "شیفت شب در روز ۲۰" }
  ]

- User: "۲۰ام تا ۲۲ام مرخصی استحقاقی و ۵ام شیفت صبح و عصر نباشم"
  Parsed Array:
  [
    { "requestType": "leave", "preferredShift": "L", "scope": "custom_days", "selectedDays": [20, 21, 22], "description": "مرخصی روزانه از ۲۰ تا ۲۲ دهم" },
    { "requestType": "avoid_shift", "preferredShift": "ME", "scope": "custom_days", "selectedDays": [5], "description": "نبودن در شیفت صبح-عصر (ME) در روز ۵" }
  ]

Respond ONLY with the filled JSON array as defined in the response schema. Keep descriptions neat and in Persian.
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: text,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            requests: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  requestType: {
                    type: Type.STRING,
                    enum: ["shift", "OFF", "leave", "avoid_shift"]
                  },
                  preferredShift: {
                    type: Type.STRING,
                    enum: ["M", "E", "N", "ME", "EN", "MN", "MEN", "OFF", "L"]
                  },
                  scope: {
                    type: Type.STRING,
                    enum: ["all", "even", "odd", "weekly_even", "weekly_odd", "custom_days", "range"]
                  },
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
          required: ["requests"]
        }
      }
    });

    const parsedData = JSON.parse(response.text || "{}");
    return NextResponse.json({ requests: parsedData.requests || [] });
  } catch (error) {
    console.error("Error parsing smart requests via Gemini API:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "خطای ناشناخته در پردازش هوش مصنوعی" },
      { status: 500 }
    );
  }
}
