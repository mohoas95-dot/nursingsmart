import { Personnel, PersonnelRequest, SystemSettings, ShiftType } from './types';

export interface SolverResult {
  assignments: {
    [personnelId: string]: {
      [day: number]: ShiftType | '';
    };
  };
  warnings: string[];
}

export function solveSchedule(
  personnel: Personnel[],
  requests: PersonnelRequest[],
  settings: SystemSettings,
  holidays: number[],
  year: number,
  month: number,
  daysInMonth: number,
  existingAssignments?: { [personnelId: string]: { [day: number]: ShiftType | '' } }
): SolverResult {
  const activePersonnel = personnel.filter((p) => p.active);
  if (activePersonnel.length === 0) {
    return { assignments: {}, warnings: ['هیچ پرسنل فعالی در این بخش وجود ندارد.'] };
  }

  // Initialize empty assignments structure
  const assignments: { [personnelId: string]: { [day: number]: ShiftType | '' } } = {};
  for (const p of activePersonnel) {
    assignments[p.id] = {};
    for (let d = 1; d <= daysInMonth; d++) {
      assignments[p.id][d] = '';
      if (existingAssignments && existingAssignments[p.id] && existingAssignments[p.id][d]) {
        assignments[p.id][d] = existingAssignments[p.id][d];
      }
    }
  }

  // Map shift hours
  const shiftHours: { [key in ShiftType]: number } = {
    M: settings.morningHours || 7,
    E: settings.eveningHours || 7,
    N: settings.nightHours || 10,
    ME: settings.morningEveningHours || 14,
    O: 0,
  };

  // Convert approved requests into fixed assignments
  const approvedRequests = requests.filter((r) => r.status === 'approved');
  for (const req of approvedRequests) {
    // Expected date format: "YYYY_MM_DD"
    const dateParts = req.date.split('_');
    const reqYear = parseInt(dateParts[0]);
    const reqMonth = parseInt(dateParts[1]);
    const reqDay = parseInt(dateParts[2]);

    if (reqYear === year && reqMonth === month && reqDay >= 1 && reqDay <= daysInMonth) {
      if (assignments[req.personnelId]) {
        if (req.type === 'off') {
          assignments[req.personnelId][reqDay] = 'O';
        } else if (req.type === 'shift' && req.shiftType) {
          assignments[req.personnelId][reqDay] = req.shiftType;
        }
      }
    }
  }

  // Help calculate current scheduled hours for personnel
  const getScheduledHours = (pId: string): number => {
    let hours = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const shift = assignments[pId][d];
      if (shift && shift !== 'O') {
        hours += shiftHours[shift] || 0;
      }
    }
    return hours;
  };

  // Auto coverage targets per day (simple heuristic based on personnel size)
  // For standard ward, we need some Morning, Evening, and Night coverage.
  const targetM = Math.max(1, Math.floor(activePersonnel.length * 0.35));
  const targetE = Math.max(1, Math.floor(activePersonnel.length * 0.3));
  const targetN = Math.max(1, Math.floor(activePersonnel.length * 0.15));

  // We schedule day by day
  for (let d = 1; d <= daysInMonth; d++) {
    const shiftTypesToFill: ('N' | 'ME' | 'M' | 'E')[] = ['N', 'ME', 'M', 'E']; // Schedule Nights first as they have highest constraints

    for (const shift of shiftTypesToFill) {
      let targetCount = 0;
      if (shift === 'N') targetCount = targetN;
      else if (shift === 'ME') targetCount = Math.max(1, Math.floor(activePersonnel.length * 0.1));
      else if (shift === 'M') targetCount = targetM;
      else if (shift === 'E') targetCount = targetE;

      // Count current assignments for this shift on day d
      let currentCount = 0;
      for (const p of activePersonnel) {
        if (assignments[p.id][d] === shift) {
          currentCount++;
        }
      }

      // Fill up to targetCount if we have eligible personnel
      let attempts = 0;
      while (currentCount < targetCount && attempts < 50) {
        attempts++;
        // Find eligible personnel
        const eligible = activePersonnel.filter((p) => {
          // Already has a shift today?
          if (assignments[p.id][d] !== '') return false;

          // Did they have Night shift yesterday? (Can't work today)
          if (d > 1 && assignments[p.id][d - 1] === 'N') return false;

          // Will they have Night shift tomorrow? (Can't work today or must be careful, but we schedule day by day)
          // If we are scheduling Night shift today, did they work Morning/Evening/ME today? (Checked by first rule)
          // Also, if they work N today, they MUST be free tomorrow (will be O tomorrow).
          if (shift === 'N' && d < daysInMonth && assignments[p.id][d + 1] !== '' && assignments[p.id][d + 1] !== 'O') {
            return false;
          }

          // Hours constraints
          const currentHours = getScheduledHours(p.id);
          const nextHours = currentHours + shiftHours[shift];
          if (p.conscript) {
            // Conscripts have strict upper limit
            if (nextHours > settings.conscriptMaxHours) return false;
          } else {
            // Normal personnel should not exceed 1.2x of target hours unless needed
            if (nextHours > p.targetWorkHours * 1.2) return false;
          }

          return true;
        });

        if (eligible.length === 0) break;

        // Sort eligible personnel to balance hours and distribute shifts fairly
        eligible.sort((a, b) => {
          // Rank by percentage of target hours completed (lowest percentage first)
          const targetA = a.conscript ? settings.conscriptMaxHours : a.targetWorkHours;
          const targetB = b.conscript ? settings.conscriptMaxHours : b.targetWorkHours;

          const ratioA = getScheduledHours(a.id) / targetA;
          const ratioB = getScheduledHours(b.id) / targetB;

          return ratioA - ratioB;
        });

        // Pick the best candidate and assign
        const chosen = eligible[0];
        assignments[chosen.id][d] = shift;
        currentCount++;
      }
    }

    // Post-processing for day d: Anyone left with empty shift gets "O" (Off) if they have no other shift
    for (const p of activePersonnel) {
      if (assignments[p.id][d] === '') {
        // Check if we need to put O
        // If yesterday was N, today MUST be O
        if (d > 1 && assignments[p.id][d - 1] === 'N') {
          assignments[p.id][d] = 'O';
        } else {
          // Default to Off if not scheduled
          assignments[p.id][d] = 'O';
        }
      }
    }
  }

  // Generate Warnings
  const warnings: string[] = [];

  // 1. Check for Night Shift Violations (N followed by non-O)
  for (const p of activePersonnel) {
    for (let d = 1; d < daysInMonth; d++) {
      if (assignments[p.id][d] === 'N' && assignments[p.id][d + 1] !== 'O') {
        warnings.push(
          `خطای شیفت شب: ${p.firstName} ${p.lastName} در روز ${d} شیفت شب داشته و روز ${d + 1} آف نشده است.`
        );
      }
    }
  }

  // 2. Check Conscript Hour limits
  for (const p of activePersonnel) {
    const hours = getScheduledHours(p.id);
    if (p.conscript && hours > settings.conscriptMaxHours) {
      warnings.push(
        `تجاوز از قانون ساعت کار طرحی: ساعت کار ${p.firstName} ${p.lastName} (${hours} ساعت) از سقف قانونی (${settings.conscriptMaxHours} ساعت) بیشتر شده است.`
      );
    } else if (!p.conscript && hours > p.targetWorkHours * 1.1) {
      warnings.push(
        `بیش‌کاری پرسنل: ساعت کار ${p.firstName} ${p.lastName} (${hours} ساعت) بیش از ۱۰٪ از موظفی (${p.targetWorkHours} ساعت) فاصله گرفته است.`
      );
    } else if (!p.conscript && hours < p.targetWorkHours * 0.9) {
      warnings.push(
        `کم‌کاری پرسنل: ساعت کار ${p.firstName} ${p.lastName} (${hours} ساعت) کمتر از ۹۰٪ از موظفی (${p.targetWorkHours} ساعت) است.`
      );
    }
  }

  // 3. Check Understaffing
  for (let d = 1; d <= daysInMonth; d++) {
    let mCount = 0, eCount = 0, nCount = 0;
    for (const p of activePersonnel) {
      if (assignments[p.id][d] === 'M' || assignments[p.id][d] === 'ME') mCount++;
      if (assignments[p.id][d] === 'E' || assignments[p.id][d] === 'ME') eCount++;
      if (assignments[p.id][d] === 'N') nCount++;
    }

    if (mCount === 0) warnings.push(`کمبود نیرو: روز ${d} فاقد پرسنل برای شیفت صبح است.`);
    if (eCount === 0) warnings.push(`کمبود نیرو: روز ${d} فاقد پرسنل برای شیفت عصر است.`);
    if (nCount === 0) warnings.push(`کمبود نیرو: روز ${d} فاقد پرسنل برای شیفت شب است.`);
  }

  return { assignments, warnings };
}
