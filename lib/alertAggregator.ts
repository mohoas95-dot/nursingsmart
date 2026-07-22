// lib/alertAggregator.ts - ادغام هشدارها و نمایش تفکیکی

import { AggregatedAlert, Personnel } from './types';

export function aggregateWarnings(
  warnings: string[],
  personnelList: Personnel[]
): AggregatedAlert[] {
  const grouped: { [personnelId: string]: string[] } = {};
  const generalWarnings: string[] = [];
  
  warnings.forEach(warning => {
    let foundId: string | null = null;
    
    for (const p of personnelList) {
      const fullName = `${p.firstName} ${p.lastName}`;
      if (warning.includes(fullName)) {
        foundId = p.id;
        break;
      }
    }
    
    if (foundId) {
      if (!grouped[foundId]) {
        grouped[foundId] = [];
      }
      grouped[foundId].push(warning);
    } else {
      generalWarnings.push(warning);
    }
  });
  
  const result: AggregatedAlert[] = [];
  for (const [personnelId, warningsList] of Object.entries(grouped)) {
    const personnel = personnelList.find(p => p.id === personnelId);
    const severity: 'low' | 'medium' | 'high' = 
      warningsList.length >= 5 ? 'high' :
      warningsList.length >= 3 ? 'medium' : 'low';
    
    result.push({
      personnelId,
      personnelName: personnel ? `${personnel.firstName} ${personnel.lastName}` : 'نامشخص',
      warningCount: warningsList.length,
      warnings: warningsList,
      severity,
      isExpanded: false,
      groupType: 'personnel',
      jobGroup: personnel?.jobGroup
    });
  }

  if (generalWarnings.length > 0) {
    const nurseGeneral: string[] = [];
    const assistantGeneral: string[] = [];
    const otherGeneral: string[] = [];

    for (const w of generalWarnings) {
      const lower = w.toLowerCase();
      const isAssistant = w.includes('کمک بهیار') || w.includes('کمک‌بهیار') || w.includes('کمک_بهیار') || lower.includes('assistant');
      const isNurse = (w.includes('پرستار') || lower.includes('nurse')) && !isAssistant;
      if (isAssistant) assistantGeneral.push(w);
      else if (isNurse) nurseGeneral.push(w);
      else otherGeneral.push(w);
    }

    const makeGeneral = (id: string, name: string, list: string[], jobGroup?: 'nurse' | 'assistant') => {
      if (list.length === 0) return;
      const severity: 'low' | 'medium' | 'high' =
        list.length >= 5 ? 'high' : list.length >= 3 ? 'medium' : 'low';
      result.push({
        personnelId: id,
        personnelName: name,
        warningCount: list.length,
        warnings: list,
        severity,
        isExpanded: true,
        groupType: 'general',
        jobGroup,
      });
    };

    makeGeneral('general-nurse', 'هشدارهای عمومی پرستاران', nurseGeneral, 'nurse');
    makeGeneral('general-assistant', 'هشدارهای عمومی کمک‌بهیاران', assistantGeneral, 'assistant');
    makeGeneral('general-other', 'هشدارهای عمومی برنامه', otherGeneral);
  }
  
  // مرتب‌سازی حذف شد تا ترتیب ثابت بماند و با dismiss کردن هشدار، پرش رخ ندهد
  // result.sort((a, b) => b.warningCount - a.warningCount);
  return result;
}

/**
 * فیلتر کردن هشدارهای باقی‌مانده (نادیده گرفته نشده)
 */
export function filterActiveWarnings(
  warnings: string[],
  dismissedWarnings: string[]
): string[] {
  return warnings.filter(w => !dismissedWarnings.includes(w));
}

/**
 * دسته‌بندی هشدارهای باقی‌مانده برای نمایش جمع‌و‌جور
 */
export function categorizeRemainingWarnings(
  warnings: string[]
): { byType: { [key: string]: string[] }; byPersonnel: { [key: string]: string[] } } {
  const byType: { [key: string]: string[] } = {
    'کمبود نیرو': [],
    'مازاد نیرو': [],
    'عدم رعایت درخواست': [],
    'مسائل دیگر': []
  };
  
  const byPersonnel: { [key: string]: string[] } = {};
  
  warnings.forEach(warning => {
    // دسته‌بندی بر اساس نوع
    if (warning.includes('کمبود نیرو') || warning.includes('Coverage Shortage')) {
      byType['کمبود نیرو'].push(warning);
    } else if (warning.includes('مازاد') || warning.includes('Overstaffing')) {
      byType['مازاد نیرو'].push(warning);
    } else if (warning.includes('Mismatched Request')) {
      byType['عدم رعایت درخواست'].push(warning);
    } else {
      byType['مسائل دیگر'].push(warning);
    }
    
    // دسته‌بندی بر اساس نام پرسنل
    const nameMatch = warning.match(/(\w+\s+\w+)/);
    if (nameMatch) {
      const name = nameMatch[1];
      if (!byPersonnel[name]) {
        byPersonnel[name] = [];
      }
      byPersonnel[name].push(warning);
    }
  });
  
  return { byType, byPersonnel };
}
