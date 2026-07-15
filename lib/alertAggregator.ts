// lib/alertAggregator.ts - فایل جدید برای ادغام هشدارها (درخواست ۵)

import { AggregatedAlert, Personnel } from './types';

export function aggregateWarnings(
  warnings: string[],
  personnelList: Personnel[]
): AggregatedAlert[] {
  const grouped: { [personnelId: string]: string[] } = {};
  
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
      isExpanded: false
    });
  }
  
  result.sort((a, b) => b.warningCount - a.warningCount);
  return result;
}
