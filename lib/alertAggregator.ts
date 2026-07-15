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
      groupType: 'personnel'
    });
  }

  if (generalWarnings.length > 0) {
    const severity: 'low' | 'medium' | 'high' =
      generalWarnings.length >= 5 ? 'high' :
      generalWarnings.length >= 3 ? 'medium' : 'low';

    result.push({
      personnelId: 'general-alerts',
      personnelName: 'هشدارهای عمومی برنامه',
      warningCount: generalWarnings.length,
      warnings: generalWarnings,
      severity,
      isExpanded: true,
      groupType: 'general'
    });
  }
  
  result.sort((a, b) => b.warningCount - a.warningCount);
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
