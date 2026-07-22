import { z } from 'zod';

const nonEmptyId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const monthKey = z.string().regex(/^\d{4}_(?:[1-9]|1[0-2])$/);
const dayKey = z.string().regex(/^(?:[1-9]|[12]\d|3[01])$/);

export const DepartmentSchema = z.object({
  id: nonEmptyId,
  name: z.string().trim().min(1).max(200),
  username: z.string().max(200).optional(),
  password: z.string().max(500).optional(),
}).strict();

// The index may legally become empty only through the authenticated hard-delete
// department endpoint; all create paths still write at least one department first.
export const DepartmentsSchema = z.array(DepartmentSchema).superRefine((departments, ctx) => {
  const ids = new Set<string>();
  for (const department of departments) {
    if (ids.has(department.id)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate department id: ${department.id}` });
    }
    ids.add(department.id);
  }
});

export const PersonnelSchema = z.object({
  id: nonEmptyId,
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().min(1).max(200),
  // کد پرسنلی اختیاری است؛ مقدار خالی مجاز است.
  personalCode: z.string().trim().max(100),
  jobGroup: z.enum(['nurse', 'assistant']),
  position: z.enum(['supervisor', 'staff', 'general', 'none']),
  employmentType: z.enum(['official', 'contract', 'conscript', 'overtime']),
  experienceYears: z.number().finite().min(0).max(100),
  active: z.boolean(),
  canBeShiftLeader: z.boolean(),
  orderIndex: z.number().int().min(0).optional(),
  username: z.string().max(200).optional(),
  password: z.string().max(500).optional(),
  locked: z.boolean().optional(),
  // برچسب روتین کاری — اختیاری با پیش‌فرض ROTATING_GENERAL (چرخشی کار عمومی)
  routineTag: z.enum([
    'MORNING_ONLY',      // صبح کار
    'LONG_SHIFT',        // لانگ کار: ME
    'EVENING_NIGHT',     // عصر شب کار: EN
    'FULL_ROTATION_MEN', // صبح عصر شب کار: MEN
    'ROTATING_GENERAL',  // چرخشی کار عمومی
  ]).nullish().default('ROTATING_GENERAL'),
}).strict();

export const PersonnelListSchema = z.array(PersonnelSchema).superRefine((items, ctx) => {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) ctx.addIssue({ code: 'custom', message: `Duplicate personnel id: ${item.id}` });
    ids.add(item.id);
  }
});

export const ShiftRequestSchema = z.object({
  id: nonEmptyId,
  personnelId: nonEmptyId,
  requestType: z.enum(['shift', 'OFF', 'leave', 'pattern', 'avoid_shift']),
  preferredShift: z.enum(['M', 'E', 'N', 'ME', 'EN', 'MN', 'MEN', 'OFF', 'L']).optional(),
  patternSteps: z.array(z.string().min(1).max(20)).max(366).optional(),
  isEssential: z.boolean(),
  scope: z.enum([
    'all', 'even', 'odd', 'saturdays', 'sundays', 'mondays', 'tuesdays',
    'wednesdays', 'thursdays', 'fridays', 'range', 'weekly_even',
    'weekly_odd', 'custom_days',
  ]),
  startDate: z.string().max(20).optional(),
  endDate: z.string().max(20).optional(),
  selectedDays: z.array(z.number().int().min(1).max(31)).max(31).optional(),
  createdAt: z.string().max(100).optional(),
  updatedAt: z.string().max(100).optional(),
}).strict();

export const RequestsSchema = z.array(ShiftRequestSchema).superRefine((items, ctx) => {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) ctx.addIssue({ code: 'custom', message: `Duplicate request id: ${item.id}` });
    ids.add(item.id);
  }
});

const DutyHoursSchema = z.object({
  official: z.number().finite().min(0),
  contract: z.number().finite().min(0),
  conscript: z.number().finite().min(0),
  overtime: z.number().finite().min(0),
}).strict();

const DemandSchema = z.object({
  morningNurse: z.number().int().min(0),
  morningAssistant: z.number().int().min(0),
  afternoonNurse: z.number().int().min(0),
  afternoonAssistant: z.number().int().min(0),
  afternoonLeader: z.number().int().min(0),
  nightNurse: z.number().int().min(0),
  nightAssistant: z.number().int().min(0),
  nightLeader: z.number().int().min(0),
}).strict();

export const SystemSettingsSchema = z.object({
  autoCalculateDutyHours: z.boolean().optional(),
  dutyHours: DutyHoursSchema,
  demand: z.object({ weekday: DemandSchema, holiday: DemandSchema }).strict(),
}).strict();

export const CredentialsSchema = z.object({
  username: z.string().max(200),
  password: z.string().max(500),
}).strict();

export const DepartmentSettingsSchema = z.object({
  activeYear: z.number().int().min(1300).max(1500).optional(),
  settings_system: SystemSettingsSchema,
  settings_credentials: CredentialsSchema,
}).strict();

const MonthlyDutyHoursSchema = z.record(z.string(), z.number().finite().min(0));
export const HolidaysSchema = z.record(monthKey, z.object({
  days: z.record(dayKey, z.string().max(500)),
  monthlyDutyHours: MonthlyDutyHoursSchema.nullable(),
}).strict());

export const FirstDayOfWeekSchema = z.record(monthKey, z.number().int().min(-1).max(6));

const AutoSubstitutionSchema = z.object({
  personnelId: nonEmptyId,
  day: z.number().int().min(1).max(31),
  originalShift: z.string().max(20),
  newShift: z.string().max(20),
  reason: z.string().max(1000),
  timestamp: z.string().max(100),
}).strict();

export const MonthlyScheduleSchema = z.object({
  year: z.number().int().min(1300).max(1500),
  month: z.number().int().min(1).max(12),
  assignments: z.record(nonEmptyId, z.record(dayKey, z.string().max(20))),
  shiftLeaders: z.record(dayKey, z.object({
    morning: nonEmptyId.optional(),
    afternoon: nonEmptyId.optional(),
    night: nonEmptyId.optional(),
  }).strict()),
  warnings: z.array(z.string().max(5000)),
  finalized: z.boolean().optional(),
  finalizedNurses: z.boolean().optional(),
  finalizedAssistants: z.boolean().optional(),
  requestsLocked: z.boolean().optional(),
  dismissedWarnings: z.array(z.string().max(5000)).optional(),
  changeLogs: z.array(z.string().max(5000)).optional(),
  lockedRows: z.array(nonEmptyId).optional(),
  autoSubstitutions: z.array(AutoSubstitutionSchema).optional(),
}).strict();

export const SchedulesSchema = z.record(monthKey, MonthlyScheduleSchema);

export const DepartmentDataSchema = z.object({
  personnel: PersonnelListSchema,
  requests: RequestsSchema,
  activeYear: z.number().int().min(1300).max(1500).optional(),
  settings_system: SystemSettingsSchema,
  settings_credentials: CredentialsSchema,
  holidays: HolidaysSchema,
  firstDayOfWeek: FirstDayOfWeekSchema,
  schedules: SchedulesSchema,
}).strict();

export const AppDatabaseStateSchema = z.object({
  departments: DepartmentsSchema,
  deptData: z.record(nonEmptyId, DepartmentDataSchema),
}).strict().superRefine((state, ctx) => {
  const departmentIds = new Set(state.departments.map((department) => department.id));
  for (const departmentId of departmentIds) {
    if (!state.deptData[departmentId]) {
      ctx.addIssue({ code: 'custom', path: ['deptData', departmentId], message: 'Missing department data' });
    }
  }
  for (const departmentId of Object.keys(state.deptData)) {
    if (!departmentIds.has(departmentId)) {
      ctx.addIssue({ code: 'custom', path: ['deptData', departmentId], message: 'Orphan department data' });
    }
  }
});

export type AppDatabaseState = z.infer<typeof AppDatabaseStateSchema>;

export const StorageResourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('departments') }).strict(),
  z.object({ type: z.literal('personnel'), departmentId: nonEmptyId }).strict(),
  z.object({ type: z.literal('requests'), departmentId: nonEmptyId }).strict(),
  z.object({ type: z.literal('settings'), departmentId: nonEmptyId }).strict(),
  z.object({ type: z.literal('holidays'), departmentId: nonEmptyId }).strict(),
  z.object({ type: z.literal('firstDayOfWeek'), departmentId: nonEmptyId }).strict(),
  z.object({ type: z.literal('schedule'), departmentId: nonEmptyId, monthKey }).strict(),
]);

export type StorageResource = z.infer<typeof StorageResourceSchema>;

export function schemaForResource(resource: StorageResource): z.ZodType {
  switch (resource.type) {
    case 'departments': return DepartmentsSchema;
    case 'personnel': return PersonnelListSchema;
    case 'requests': return RequestsSchema;
    case 'settings': return DepartmentSettingsSchema;
    case 'holidays': return HolidaysSchema;
    case 'firstDayOfWeek': return FirstDayOfWeekSchema;
    case 'schedule': return MonthlyScheduleSchema;
  }
}
