# Phase 3 Design: Optimizer Facade Integration

## 1. Optimizer Facade Design

### Input Contract

```typescript
interface OptimizerFacadeInput {
  jobGroup: JobGroup;
  year: number;
  month: number;
  personnel: ReadonlyArray<Personnel>;
  requests: ReadonlyArray<ShiftRequest>;
  settings: SystemSettings;
  holidays: Readonly<Record<number, string>>;
  firstDayOfWeek: number | undefined;
  monthlyDutyHours: { official: number; contract: number } | null;
  currentSchedule: MonthlySchedule | null;
  lockState: ScheduleLockState;
  dismissedWarnings: string[];
}
```

### Injected Dependencies

```typescript
interface OptimizerDependencies {
  // Pure solver function
  solver: (
    year: number,
    month: number,
    personnel: ReadonlyArray<Personnel>,
    requests: ReadonlyArray<ShiftRequest>,
    settings: SystemSettings,
    holidays: Readonly<Record<number, string>>,
    firstDayOfWeek: number | undefined,
    monthlyDutyHours: { official: number; contract: number } | null
  ) => { assignments: Record<string, Record<number, string>>; warnings: string[] };

  // Pure verification function
  verifier: (
    year: number,
    month: number,
    personnel: ReadonlyArray<Personnel>,
    assignments: Record<string, Record<number, string>>,
    settings: SystemSettings,
    holidays: Readonly<Record<number, string>>,
    firstDayOfWeek: number | undefined,
    requests: ReadonlyArray<ShiftRequest>
  ) => { shiftLeaders: Record<number, any>; warnings: string[] };

  // Persistence layer
  persistence: {
    saveSchedule(schedule: MonthlySchedule, departmentId: string): Promise<void>;
  };

  // UI feedback
  ui: {
    setSolvingTarget(target: JobGroup | null): void;
    showConfirmation(message: string): boolean;
    showError(message: string): void;
  };

  // Configuration
  delayMs: number; // setTimeout delay for loading animation (default: 1500)
}
```

### Facade Flow

```typescript
async function runOptimizerFacade(
  input: OptimizerFacadeInput,
  deps: OptimizerDependencies,
  departmentId: string
): Promise<OptimizerResult> {
  const { jobGroup, lockState } = input;
  const monthKey = `${input.year}_${input.month}`;

  // Step 1: Check if schedule is locked
  const finalizedMonthsForGroup =
    jobGroup === 'nurse'
      ? lockState.finalizedNursesMonths
      : lockState.finalizedAssistantsMonths;

  const isLocked = isScheduleLocked(jobGroup, finalizedMonthsForGroup, monthKey);

  if (isLocked) {
    const groupTitle = jobGroup === 'nurse' ? 'پرستاران' : 'کمک‌بهیاران';
    const confirmed = deps.ui.showConfirmation(
      `برنامه این ماه ثبت نهایی و قفل شده است. آیا مایلید قفل لیست را باز کرده و بازتولید هوشمند ${groupTitle} را اجرا کنید؟`
    );
    if (!confirmed) {
      return { success: false, schedule: null, personnelUpdated: 0 };
    }
  }

  // Step 2: Show loading state
  deps.ui.setSolvingTarget(jobGroup);

  // Step 3: Delay for loading animation (setTimeout)
  await new Promise(resolve => setTimeout(resolve, deps.delayMs));

  try {
    // Step 4: Run solver (injected)
    const optimized = deps.solver(
      input.year,
      input.month,
      input.personnel,
      input.requests,
      input.settings,
      input.holidays,
      input.firstDayOfWeek,
      input.monthlyDutyHours
    );

    // Step 5: Merge assignments (pure domain function from Phase 2)
    const mergedAssignments = mergeOptimizerAssignments(
      input.currentSchedule?.assignments,
      optimized.assignments,
      input.personnel,
      jobGroup,
      lockState.lockedRows
    );

    // Step 6: Verify coverage and leaders (injected)
    const verification = deps.verifier(
      input.year,
      input.month,
      input.personnel,
      mergedAssignments,
      input.settings,
      input.holidays,
      input.firstDayOfWeek,
      input.requests
    );

    // Step 7: Build new schedule
    const newSchedule: MonthlySchedule = {
      ...(input.currentSchedule || {
        year: input.year,
        month: input.month,
        assignments: {},
        shiftLeaders: {},
        warnings: [],
      }),
      year: input.year,
      month: input.month,
      assignments: mergedAssignments,
      shiftLeaders: verification.shiftLeaders,
      warnings: verification.warnings,
      finalizedNurses: jobGroup === 'nurse' ? false : input.currentSchedule?.finalizedNurses,
      finalizedAssistants: jobGroup === 'assistant' ? false : input.currentSchedule?.finalizedAssistants,
      dismissedWarnings: [...input.dismissedWarnings],
      lockedRows: [...lockState.lockedRows],
    };

    // Step 8: Persist (injected)
    await deps.persistence.saveSchedule(newSchedule, departmentId);

    // Step 9: Count updated personnel
    const personnelUpdated = input.personnel.filter(
      (p) => p.jobGroup === jobGroup && !lockState.lockedRows.includes(p.id)
    ).length;

    return {
      success: true,
      schedule: newSchedule,
      personnelUpdated,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    deps.ui.showError(`خطا در اجرای بهینه‌ساز: ${errorMessage}`);
    return {
      success: false,
      schedule: null,
      error: errorMessage,
      personnelUpdated: 0,
    };
  } finally {
    // Step 10: Clear loading state
    deps.ui.setSolvingTarget(null);
  }
}
```

### Handler Migration (app/page.tsx)

```typescript
const handleRunOptimizer = async (jobGroup: JobGroup) => {
  const deptId = selectedDepartmentId || 'sepehr';

  // Create persistence adapter
  const persistenceAdapter: SchedulePersistence = {
    saveSchedule: async (newSchedule) => {
      const nextDb = getFreshDbCopy();
      if (!nextDb.deptData) nextDb.deptData = {};

      const oldDept = nextDb.deptData[deptId] || {
        personnel: [],
        requests: [],
        settings_system: INITIAL_SETTINGS,
        settings_credentials: { username: 'headnurse', password: '123456' },
        holidays: {},
        firstDayOfWeek: {},
        schedules: {},
      };

      const updatedDept = {
        ...oldDept,
        schedules: {
          ...oldDept.schedules,
          [`${currentYear}_${currentMonth}`]: newSchedule,
        },
      };

      nextDb.deptData[deptId] = updatedDept;
      await saveDbState(nextDb);
    },
  };

  // Create UI adapter
  const uiAdapter: ScheduleUIFeedback = {
    setSolvingTarget: (target) => setSolvingTarget(target),
    showConfirmation: (message) => confirm(message),
    showError: (message) => console.error(message),
  };

  // Call Facade
  const result = await runOptimizerFacade(
    {
      jobGroup,
      year: currentYear,
      month: currentMonth,
      personnel,
      requests,
      settings,
      holidays: customHolidays,
      firstDayOfWeek: firstDayOfWeekIndex,
      monthlyDutyHours,
      currentSchedule: schedule,
      lockState: {
        finalizedNursesMonths,
        finalizedAssistantsMonths,
        lockedRows,
      },
      dismissedWarnings,
    },
    {
      solver: solveWithPriority,
      verifier: verifyCoverageAndLeaders,
      persistence: persistenceAdapter,
      ui: uiAdapter,
      delayMs: 1500,
    },
    deptId
  );

  if (!result.success && result.error) {
    alert('خطا در اجرای بهینه‌ساز: ' + result.error);
  }
};
```

---

## 2. UI Components to Extract (Priority Order)

### Tier 1: Low Risk, High Value

| Component | Lines (est.) | Risk Score | Reason |
|-----------|--------------|------------|--------|
| `AddPersonnelModal` | ~170 | 3/14 | Isolated modal, clear props interface |
| `AddRequestModal` | ~220 | 4/14 | Isolated modal, form logic |
| `AlertCenter` | ~250 | 5/14 | Read-only view, minimal state |

### Tier 2: Medium Risk, Medium Value

| Component | Lines (est.) | Risk Score | Reason |
|-----------|--------------|------------|--------|
| `ScheduleGrid` | ~600 | 8/14 | Complex grid, cell editing, but isolated |
| `PersonnelTable` | ~400 | 7/14 | Table view, CRUD buttons, but isolated |
| `ReportsView` | ~350 | 6/14 | Read-only reports, export buttons |

### Tier 3: High Risk, Deferred

| Component | Lines (est.) | Risk Score | Reason |
|-----------|--------------|------------|--------|
| `SettingsPanel` | ~500 | 10/14 | Complex forms, multiple sections |
| `CalendarView` | ~450 | 9/14 | Holiday management, occasions |
| `RequestManager` | ~550 | 11/14 | Complex filtering, bulk operations |

---

## 3. Custom Hooks to Extract

### Hook 1: `useScheduleState`

```typescript
interface UseScheduleStateReturn {
  schedule: MonthlySchedule | null;
  solvingTarget: JobGroup | null;
  finalizedNursesMonths: string[];
  finalizedAssistantsMonths: string[];
  lockedRows: string[];
  dismissedWarnings: string[];
  setSolvingTarget: (target: JobGroup | null) => void;
  setLockedRows: (rows: string[]) => void;
  setDismissedWarnings: (warnings: string[]) => void;
}

function useScheduleState(
  currentYear: number,
  currentMonth: number,
  fullDbState: AppDatabaseState | null,
  selectedDepartmentId: string
): UseScheduleStateReturn {
  // Extract all schedule-related state and effects
}
```

### Hook 2: `usePersonnelManager`

```typescript
interface UsePersonnelManagerReturn {
  personnel: Personnel[];
  showAddPersonnelModal: boolean;
  editingPersonnel: Personnel | null;
  formData: PersonnelFormData;
  openAddModal: () => void;
  openEditModal: (person: Personnel) => void;
  closeModal: () => void;
  updateFormData: (field: string, value: any) => void;
  savePersonnel: () => Promise<void>;
  deletePersonnel: (id: string) => Promise<void>;
}

function usePersonnelManager(
  initialPersonnel: Personnel[],
  onSave: (updated: Personnel[]) => Promise<void>,
  selectedDepartmentId: string
): UsePersonnelManagerReturn {
  // Extract personnel CRUD state and handlers
}
```

### Hook 3: `useRequestManager`

```typescript
interface UseRequestManagerReturn {
  requests: ShiftRequest[];
  showAddRequestModal: boolean;
  draftRequests: ShiftRequest[];
  openAddModal: () => void;
  closeModal: () => void;
  addDraftRequest: (request: ShiftRequest) => void;
  removeDraftRequest: (id: string) => void;
  submitRequests: () => Promise<void>;
  deleteRequest: (id: string) => Promise<void>;
  deleteAllPersonRequests: (personnelId: string) => Promise<void>;
}

function useRequestManager(
  initialRequests: ShiftRequest[],
  personnel: Personnel[],
  onSave: (updated: ShiftRequest[]) => Promise<void>,
  selectedDepartmentId: string
): UseRequestManagerReturn {
  // Extract request management state and handlers
}
```

---

## 4. Extraction Strategy (Incremental)

### Step 1: Optimizer Facade (Day 1)
- ✅ Create `runOptimizerFacade` in `shift-write-facade.ts`
- ✅ Migrate `handleRunOptimizer` to use Facade
- ✅ Test: Verify optimizer still works correctly
- ✅ TypeScript: Zero errors

### Step 2: Extract Modals (Day 2)
- ✅ Extract `AddPersonnelModal` component
- ✅ Extract `AddRequestModal` component
- ✅ Test: Verify modals open/close correctly
- ✅ TypeScript: Zero errors

### Step 3: Extract AlertCenter (Day 2-3)
- ✅ Extract `AlertCenter` component
- ✅ Test: Verify alerts display correctly
- ✅ TypeScript: Zero errors

### Step 4: Extract Hooks (Day 3-4)
- ✅ Extract `useScheduleState`
- ✅ Extract `usePersonnelManager`
- ✅ Extract `useRequestManager`
- ✅ Test: Verify state management works
- ✅ TypeScript: Zero errors

### Step 5: Extract ScheduleGrid (Day 4-5)
- ✅ Extract `ScheduleGrid` component
- ✅ Test: Verify grid renders and edits work
- ✅ TypeScript: Zero errors

### Step 6: Extract PersonnelTable (Day 5)
- ✅ Extract `PersonnelTable` component
- ✅ Test: Verify table renders and CRUD works
- ✅ TypeScript: Zero errors

---

## 5. Safety Rules

### Rule 1: One Component/Hook at a Time
- Extract one item
- Verify TypeScript compilation
- Verify runtime behavior (manual test)
- Commit before next extraction

### Rule 2: Props Interface First
- Define TypeScript interface for component props
- Ensure all dependencies are explicit
- No implicit global state access

### Rule 3: State Lifting Strategy
- If component needs parent state → lift to parent
- If component manages local state → keep local
- If state is shared → extract to custom hook

### Rule 4: Handler Passing
- Pass handlers as props (not inline definitions)
- Handlers remain in parent until Phase 4 (Server Actions)
- Components are "dumb" (presentational) where possible

### Rule 5: Hard Delete Preservation
- Department deletion remains hard delete
- No soft-delete flags added
- No `deletedAt` timestamps

---

## 6. Success Criteria

### Phase 3 Complete When:
- ✅ `handleRunOptimizer` uses Facade
- ✅ 3+ modals extracted
- ✅ 3+ custom hooks extracted
- ✅ 2+ major components extracted
- ✅ `page.tsx` reduced by 1500+ lines
- ✅ All 67+ tests still pass
- ✅ Zero TypeScript errors
- ✅ Zero runtime regressions

### Metrics Target:
| Metric | Before | After |
|--------|--------|-------|
| `page.tsx` lines | 6,399 | ~4,800 |
| Inline handlers | 30+ | ~20 |
| Inline state | 111 | ~80 |
| Extracted components | 0 | 5+ |
| Extracted hooks | 1 | 4+ |

---

## 7. Approval Request

**Ready to proceed with Step 1 (Optimizer Facade)?**

Please confirm:
1. ✅ Approve `runOptimizerFacade` design with DI
2. ✅ Approve Tier 1 components for extraction (modals + AlertCenter)
3. ✅ Approve 3 custom hooks (schedule, personnel, requests)
4. ✅ Approve incremental extraction strategy

**Awaiting your approval before writing code.**
