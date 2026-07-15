// lib/smartSuggestion.ts - فایل جدید برای پیشنهادات هوشمند (درخواست ۷)

import { Personnel, ShiftRequest, ShiftType, SmartSuggestion } from './types';
import { generateJalaliMonthCalendar } from './jalali';

export function generateSmartSuggestions(
  year: number,
  month: number,
  personnelList: Personnel[],
  requests: ShiftRequest[],
  assignments: { [pId: string]: { [day: number]: ShiftType } },
  warnings: string[],
  customHolidays: { [day: number]: string } = {},
  firstDayOfWeekIndex?: number
): SmartSuggestion[] {
  
  const suggestions: SmartSuggestion[] = [];
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const totalDays = calendar.length;
  
  if (warnings.length === 0) return [];
  
  const warningGroups: { [key: string]: string[] } = {};
  
  warnings.forEach(w => {
    for (const p of personnelList) {
      const fullName = `${p.firstName} ${p.lastName}`;
      if (w.includes(fullName)) {
        if (!warningGroups[p.id]) warningGroups[p.id] = [];
        warningGroups[p.id].push(w);
        break;
      }
    }
  });
  
  for (const [pId, pWarnings] of Object.entries(warningGroups)) {
    if (pWarnings.length < 2) continue;
    
    const personnel = personnelList.find(p => p.id === pId);
    if (!personnel) continue;
    
    const problemDays: number[] = [];
    pWarnings.forEach(w => {
      const match = w.match(/روز (\d+)/);
      if (match) {
        const day = parseInt(match[1]);
        if (!problemDays.includes(day)) {
          problemDays.push(day);
        }
      }
    });
    
    for (const day of problemDays) {
      const currentShift = assignments[pId]?.[day] || 'OFF';
      if (currentShift === 'OFF') continue;
      
      const suggestedShift: ShiftType = 
        currentShift === 'MEN' ? 'ME' :
        currentShift === 'MN' ? 'M' :
        currentShift === 'EN' ? 'E' :
        currentShift === 'ME' ? 'M' :
        currentShift === 'N' ? 'OFF' :
        currentShift === 'E' ? 'OFF' :
        'OFF';
      
      if (suggestedShift === currentShift) continue;
      
      const resolvedWarnings: string[] = [];
      const newWarnings: string[] = [];
      
      for (const w of pWarnings) {
        if (w.includes(`شیفت ${currentShift} تخصیص یافته`)) {
          resolvedWarnings.push(w);
        }
      }
      
      if (resolvedWarnings.length > 0) {
        suggestions.push({
          id: `suggestion_${Date.now()}_${pId}_${day}`,
          description: `${personnel.firstName} ${personnel.lastName}: تغییر شیفت روز ${day} از ${currentShift} به ${suggestedShift}`,
          impact: {
            resolvedWarnings,
            newWarnings,
            warningCountChange: -resolvedWarnings.length
          },
          changes: [{
            personnelId: pId,
            day,
            fromShift: currentShift,
            toShift: suggestedShift
          }],
          priority: resolvedWarnings.length
        });
      }
    }
  }
  
  suggestions.sort((a, b) => b.priority - a.priority);
  return suggestions.slice(0, 5);
}
