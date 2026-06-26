'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Calendar as CalendarIcon,
  Users,
  Settings,
  CheckSquare,
  Plus,
  Edit2,
  Trash2,
  Lock,
  Unlock,
  AlertTriangle,
  Check,
  X,
  Play,
  Printer,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  UserPlus,
  RefreshCw,
  LogOut,
  Info
} from 'lucide-react';

import {
  db,
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot
} from '@/lib/firebase';
import {
  getJalaliMonthDays,
  getWeekdayOfFirstDay,
  JALALI_MONTH_NAMES,
  WEEKDAYS
} from '@/lib/jalali';
import {
  Department,
  Personnel,
  PersonnelRequest,
  SystemSettings,
  HolidayConfig,
  ScheduleConfig,
  ShiftType,
  ContractType,
  PersonnelRole,
  GenderType
} from '@/lib/types';
import { solveSchedule } from '@/lib/solver';
import { INITIAL_SETTINGS } from '@/lib/mockData';

export default function Home() {
  // Navigation & UI State
  const [activeTab, setActiveTab] = useState<'schedule' | 'personnel' | 'requests' | 'settings'>('schedule');
  const [currentYear, setCurrentYear] = useState(1405);
  const [currentMonth, setCurrentMonth] = useState(4); // default to Tir

  // Database Collections
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('sepehr');
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [requests, setRequests] = useState<PersonnelRequest[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(INITIAL_SETTINGS);
  const [holidays, setHolidays] = useState<number[]>([]);
  const [schedule, setSchedule] = useState<ScheduleConfig>({ finalized: false, assignments: {} });

  // Authentication & Access State
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Modals & Forms State
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptUsername, setNewDeptUsername] = useState('');
  const [newDeptPassword, setNewDeptPassword] = useState('');

  const [isPersonnelModalOpen, setIsPersonnelModalOpen] = useState(false);
  const [editingPersonnel, setEditingPersonnel] = useState<Partial<Personnel>>({});

  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [newRequest, setNewRequest] = useState<Partial<PersonnelRequest>>({
    personnelId: '',
    type: 'off',
    shiftType: 'M',
    status: 'pending',
    date: '1405_04_01'
  });

  const [isDeleteDeptConfirmOpen, setIsDeleteDeptConfirmOpen] = useState(false);
  const [deleteDeptUsername, setDeleteDeptUsername] = useState('');
  const [deleteDeptPassword, setDeleteDeptPassword] = useState('');

  // Status & Alerts
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isS3Configured, setIsS3Configured] = useState(false);

  // Warnings compiled from Solver or constraints
  const [scheduleWarnings, setScheduleWarnings] = useState<string[]>([]);
  const [showWarningsList, setShowWarningsList] = useState(false);

  // Fetch S3 Config Status
  useEffect(() => {
    const fetchS3Status = async () => {
      try {
        const res = await fetch('/api/storage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getS3ConfigStatus' }),
        });
        const data = await res.json();
        setIsS3Configured(data.configured);
      } catch (err) {
        console.error('Error checking S3 status:', err);
      }
    };
    fetchS3Status();
  }, []);

  // Show customized Toast message
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Real-time synchronization
  useEffect(() => {
    setLoading(true);
    // 1. Sync Departments
    const unsubDepts = onSnapshot(collection(db, 'departments'), (snapshot: any) => {
      const deptsList: Department[] = [];
      snapshot.forEach((doc: any) => {
        deptsList.push({ id: doc.id, ...doc.data() });
      });
      setDepartments(deptsList);
      if (deptsList.length > 0 && !deptsList.find((d) => d.id === selectedDeptId)) {
        setSelectedDeptId(deptsList[0].id);
      }
    });

    return () => unsubDepts();
  }, []);

  // Sync selected department resources
  useEffect(() => {
    if (!selectedDeptId) return;

    setLoading(true);
    setIsAuthorized(false); // Reset authorization on department change

    // 2. Sync Personnel
    const unsubPersonnel = onSnapshot(
      collection(db, `departments/${selectedDeptId}/personnel`),
      (snapshot: any) => {
        const list: Personnel[] = [];
        snapshot.forEach((doc: any) => {
          list.push({ id: doc.id, ...doc.data() });
        });
        setPersonnel(list.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0)));
      }
    );

    // 3. Sync Requests
    const unsubRequests = onSnapshot(
      collection(db, `departments/${selectedDeptId}/requests`),
      (snapshot: any) => {
        const list: PersonnelRequest[] = [];
        snapshot.forEach((doc: any) => {
          list.push({ id: doc.id, ...doc.data() });
        });
        setRequests(list);
      }
    );

    // 4. Sync Settings
    const unsubSettings = onSnapshot(
      doc(db, `departments/${selectedDeptId}/settings`, 'system'),
      (docSnap: any) => {
        if (docSnap.exists()) {
          setSettings(docSnap.data());
        } else {
          setSettings(INITIAL_SETTINGS);
        }
      }
    );

    // 5. Sync Holidays
    const holidayDocId = `${currentYear}_${currentMonth}`;
    const unsubHolidays = onSnapshot(
      doc(db, `departments/${selectedDeptId}/holidays`, holidayDocId),
      (docSnap: any) => {
        if (docSnap.exists() && docSnap.data().days) {
          setHolidays(docSnap.data().days);
        } else {
          setHolidays([]);
        }
      }
    );

    // 6. Sync Schedule Configuration
    const scheduleDocId = `${currentYear}_${currentMonth}`;
    const unsubSchedule = onSnapshot(
      doc(db, `departments/${selectedDeptId}/schedules`, scheduleDocId),
      (docSnap: any) => {
        if (docSnap.exists()) {
          setSchedule(docSnap.data());
        } else {
          setSchedule({ finalized: false, assignments: {} });
        }
        setLoading(false);
      }
    );

    return () => {
      unsubPersonnel();
      unsubRequests();
      unsubSettings();
      unsubHolidays();
      unsubSchedule();
    };
  }, [selectedDeptId, currentYear, currentMonth]);

  // Recalculate schedule warnings dynamically whenever the schedule, personnel, settings or holidays change
  useEffect(() => {
    if (personnel.length === 0) return;
    const daysInMonth = getJalaliMonthDays(currentYear, currentMonth);
    
    // We can solve or dry-run constraints
    const solved = solveSchedule(
      personnel,
      requests,
      settings,
      holidays,
      currentYear,
      currentMonth,
      daysInMonth,
      schedule.assignments
    );
    setScheduleWarnings(solved.warnings);
  }, [schedule, personnel, requests, settings, holidays, currentYear, currentMonth]);

  // Department Management
  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeptName.trim() || !newDeptUsername.trim() || !newDeptPassword.trim()) {
      showToast('لطفا همه فیلدها را پر کنید.', 'error');
      return;
    }

    const deptId = newDeptName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u0600-\u06FF-]/g, '');
    const isExist = departments.find((d) => d.id === deptId);
    if (isExist) {
      showToast('بخشی با این نام قبلاً ایجاد شده است.', 'error');
      return;
    }

    try {
      // Create dept document
      await setDoc(doc(db, 'departments', deptId), {
        id: deptId,
        name: newDeptName,
      });

      // Set default credentials
      await setDoc(doc(db, `departments/${deptId}/settings`, 'credentials'), {
        username: newDeptUsername,
        password: newDeptPassword,
      });

      // Set default settings
      await setDoc(doc(db, `departments/${deptId}/settings`, 'system'), INITIAL_SETTINGS);

      // Add head nurse as first personnel
      await setDoc(doc(db, `departments/${deptId}/personnel`, 'head-nurse'), {
        id: 'head-nurse',
        firstName: 'سرپرستار',
        lastName: newDeptName,
        conscript: false,
        contractType: 'official',
        role: 'head_nurse',
        gender: 'female',
        active: true,
        targetWorkHours: 160,
        orderIndex: 0,
      });

      setSelectedDeptId(deptId);
      setIsDeptModalOpen(false);
      setNewDeptName('');
      setNewDeptUsername('');
      setNewDeptPassword('');
      showToast(`بخش «${newDeptName}» با موفقیت ایجاد شد.`);
    } catch (err) {
      console.error(err);
      showToast('خطا در ذخیره‌سازی اطلاعات.', 'error');
    }
  };

  const handleDeleteDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const credsSnap = await getDoc(doc(db, `departments/${selectedDeptId}/settings`, 'credentials'));
      if (!credsSnap.exists()) {
        showToast('اطلاعات احراز هویت این بخش یافت نشد.', 'error');
        return;
      }
      const creds = credsSnap.data();
      if (creds.username !== deleteDeptUsername || creds.password !== deleteDeptPassword) {
        showToast('نام کاربری یا رمز عبور سرپرستار اشتباه است.', 'error');
        return;
      }

      await deleteDoc(doc(db, 'departments', selectedDeptId));
      setIsDeleteDeptConfirmOpen(false);
      setDeleteDeptUsername('');
      setDeleteDeptPassword('');
      showToast('بخش مورد نظر با موفقیت حذف شد.');
      
      // Auto switch department
      const remaining = departments.filter((d) => d.id !== selectedDeptId);
      if (remaining.length > 0) {
        setSelectedDeptId(remaining[0].id);
      }
    } catch (err) {
      console.error(err);
      showToast('خطا در حذف بخش.', 'error');
    }
  };

  // Manager Authorization Login
  const handleAuthLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      const credsSnap = await getDoc(doc(db, `departments/${selectedDeptId}/settings`, 'credentials'));
      if (!credsSnap.exists()) {
        setAuthError('اطلاعات ورود سرپرستار برای این بخش تنظیم نشده است.');
        return;
      }
      const creds = credsSnap.data();
      if (creds.username === authUsername && creds.password === authPassword) {
        setIsAuthorized(true);
        setIsAuthModalOpen(false);
        setAuthUsername('');
        setAuthPassword('');
        showToast('با موفقیت به عنوان سرپرستار وارد شدید.', 'success');
      } else {
        setAuthError('نام کاربری یا رمز عبور اشتباه است.');
      }
    } catch (err) {
      console.error(err);
      setAuthError('خطا در اتصال به پایگاه داده.');
    }
  };

  // Save System Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthorized) return;
    try {
      await setDoc(doc(db, `departments/${selectedDeptId}/settings`, 'system'), settings);
      showToast('تنظیمات بخش با موفقیت به روز رسانی شد.');
    } catch (err) {
      console.error(err);
      showToast('خطا در ذخیره تنظیمات.', 'error');
    }
  };

  // Toggle Holiday Config
  const handleToggleHoliday = async (day: number) => {
    if (!isAuthorized || schedule.finalized) return;
    const updatedHolidays = holidays.includes(day)
      ? holidays.filter((d) => d !== day)
      : [...holidays, day].sort((a, b) => a - b);

    try {
      await setDoc(doc(db, `departments/${selectedDeptId}/holidays`, `${currentYear}_${currentMonth}`), {
        days: updatedHolidays,
      });
      setHolidays(updatedHolidays);
    } catch (err) {
      console.error(err);
      showToast('خطا در ویرایش روز تعطیل.', 'error');
    }
  };

  // Personnel Actions
  const handleSavePersonnel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthorized) return;

    const id = editingPersonnel.id || `p_${Date.now()}`;
    const pData: Personnel = {
      id,
      firstName: editingPersonnel.firstName || '',
      lastName: editingPersonnel.lastName || '',
      conscript: editingPersonnel.contractType === 'conscript',
      contractType: editingPersonnel.contractType || 'official',
      role: editingPersonnel.role || 'nurse',
      gender: editingPersonnel.gender || 'female',
      active: editingPersonnel.active !== undefined ? editingPersonnel.active : true,
      targetWorkHours: Number(editingPersonnel.targetWorkHours) || 160,
      phone: editingPersonnel.phone || '',
      email: editingPersonnel.email || '',
      orderIndex: editingPersonnel.orderIndex !== undefined ? editingPersonnel.orderIndex : personnel.length,
    };

    try {
      await setDoc(doc(db, `departments/${selectedDeptId}/personnel`, id), pData);
      setIsPersonnelModalOpen(false);
      setEditingPersonnel({});
      showToast('اطلاعات پرسنل با موفقیت ذخیره شد.');
    } catch (err) {
      console.error(err);
      showToast('خطا در ذخیره اطلاعات پرسنل.', 'error');
    }
  };

  const handleDeletePersonnel = async (id: string) => {
    if (!isAuthorized) return;
    if (!confirm('آیا از حذف این پرسنل اطمینان دارید؟')) return;

    try {
      await deleteDoc(doc(db, `departments/${selectedDeptId}/personnel`, id));
      showToast('پرسنل با موفقیت از سیستم حذف شد.');
    } catch (err) {
      console.error(err);
      showToast('خطا در حذف پرسنل.', 'error');
    }
  };

  // Shift assignment editor
  const handleSetCellShift = async (personnelId: string, day: number, shift: ShiftType | '') => {
    if (!isAuthorized || schedule.finalized) return;

    const updatedAssignments = {
      ...schedule.assignments,
      [personnelId]: {
        ...(schedule.assignments[personnelId] || {}),
        [day]: shift,
      },
    };

    try {
      await setDoc(
        doc(db, `departments/${selectedDeptId}/schedules`, `${currentYear}_${currentMonth}`),
        {
          ...schedule,
          assignments: updatedAssignments,
        },
        { merge: true }
      );
    } catch (err) {
      console.error(err);
      showToast('خطا در تغییر نوبت.', 'error');
    }
  };

  // Solver Trigger
  const handleAutoSchedule = () => {
    if (!isAuthorized || schedule.finalized) return;
    if (personnel.length === 0) {
      showToast('ابتدا باید پرسنل بخش را تعریف کنید.', 'error');
      return;
    }

    const daysInMonth = getJalaliMonthDays(currentYear, currentMonth);
    showToast('در حال حل جدول شیفت‌ها و بهینه‌سازی...', 'info');

    try {
      // Calculate schedule using the smart solver
      const solved = solveSchedule(
        personnel,
        requests,
        settings,
        holidays,
        currentYear,
        currentMonth,
        daysInMonth,
        schedule.assignments // pass current assignments to keep user manual entries
      );

      setDoc(
        doc(db, `departments/${selectedDeptId}/schedules`, `${currentYear}_${currentMonth}`),
        {
          finalized: false,
          assignments: solved.assignments,
          dismissedWarnings: [],
        }
      );

      showToast('جدول شیفت‌ها با موفقیت حل و تکمیل گردید.', 'success');
    } catch (err) {
      console.error(err);
      showToast('خطا در پردازش هوشمند نوبت‌ها.', 'error');
    }
  };

  // Reset/Clear assignments for current month
  const handleClearSchedule = async () => {
    if (!isAuthorized || schedule.finalized) return;
    if (!confirm('آیا از پاک کردن کامل جدول شیفت‌های این ماه اطمینان دارید؟')) return;

    try {
      await setDoc(
        doc(db, `departments/${selectedDeptId}/schedules`, `${currentYear}_${currentMonth}`),
        {
          finalized: false,
          assignments: {},
          dismissedWarnings: [],
        }
      );
      showToast('جدول شیفت‌های این ماه پاک شد.');
    } catch (err) {
      console.error(err);
      showToast('خطا در پاک کردن جدول شیفت‌ها.', 'error');
    }
  };

  // Finalize/Lock Schedule
  const handleFinalizeSchedule = async (lock: boolean) => {
    if (!isAuthorized) return;
    try {
      await setDoc(
        doc(db, `departments/${selectedDeptId}/schedules`, `${currentYear}_${currentMonth}`),
        { finalized: lock },
        { merge: true }
      );
      showToast(lock ? 'برنامه ماهانه تایید نهایی شد و قفل گردید.' : 'قفل برنامه باز شد.');
    } catch (err) {
      console.error(err);
      showToast('خطا در تغییر وضعیت تایید برنامه.', 'error');
    }
  };

  // Requests Actions
  const handleSaveRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRequest.personnelId || !newRequest.date) {
      showToast('لطفا همه اطلاعات درخواست را تکمیل کنید.', 'error');
      return;
    }

    const id = `req_${Date.now()}`;
    // Format date correctly
    const formattedDate = newRequest.date.replace(/\//g, '_');

    try {
      await setDoc(doc(db, `departments/${selectedDeptId}/requests`, id), {
        id,
        personnelId: newRequest.personnelId,
        date: formattedDate,
        type: newRequest.type,
        shiftType: newRequest.type === 'shift' ? newRequest.shiftType : undefined,
        status: newRequest.status || 'pending',
        reason: newRequest.reason || '',
      });

      setIsRequestModalOpen(false);
      setNewRequest({
        personnelId: '',
        type: 'off',
        shiftType: 'M',
        status: 'pending',
        date: '1405_04_01',
      });
      showToast('درخواست جدید با موفقیت ثبت شد.');
    } catch (err) {
      console.error(err);
      showToast('خطا در ثبت درخواست.', 'error');
    }
  };

  const handleUpdateRequestStatus = async (id: string, status: 'approved' | 'rejected') => {
    if (!isAuthorized) return;
    try {
      await setDoc(
        doc(db, `departments/${selectedDeptId}/requests`, id),
        { status },
        { merge: true }
      );
      showToast(status === 'approved' ? 'درخواست تایید شد.' : 'درخواست رد شد.');
    } catch (err) {
      console.error(err);
      showToast('خطا در بروزرسانی وضعیت درخواست.', 'error');
    }
  };

  const handleDeleteRequest = async (id: string) => {
    if (!isAuthorized) return;
    if (!confirm('آیا از حذف این درخواست اطمینان دارید؟')) return;

    try {
      await deleteDoc(doc(db, `departments/${selectedDeptId}/requests`, id));
      showToast('درخواست با موفقیت حذف شد.');
    } catch (err) {
      console.error(err);
      showToast('خطا در حذف درخواست.', 'error');
    }
  };

  // Print schedule helper
  const handlePrint = () => {
    window.print();
  };

  // Calculations for Schedule Statistics
  const daysInMonth = getJalaliMonthDays(currentYear, currentMonth);
  const firstDayWeekday = getWeekdayOfFirstDay(currentYear, currentMonth);

  const getShiftColorClass = (shift: ShiftType | '') => {
    switch (shift) {
      case 'M': return 'bg-cyan-50 text-cyan-700 border-cyan-200 hover:bg-cyan-100';
      case 'E': return 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100';
      case 'N': return 'bg-indigo-900 text-white border-indigo-950 hover:bg-indigo-950';
      case 'ME': return 'bg-amber-100 text-amber-800 border-amber-300 font-bold hover:bg-amber-200';
      case 'O': return 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200';
      default: return 'bg-white text-slate-400 border-slate-100 hover:bg-slate-50';
    }
  };

  const getShiftLabel = (shift: ShiftType | '') => {
    switch (shift) {
      case 'M': return 'صبح';
      case 'E': return 'عصر';
      case 'N': return 'شب';
      case 'ME': return 'صبح-عصر';
      case 'O': return 'آف';
      default: return '-';
    }
  };

  const getPersonnelScheduledHours = (pId: string): number => {
    let hours = 0;
    const shiftHours: { [key in ShiftType]: number } = {
      M: settings.morningHours,
      E: settings.eveningHours,
      N: settings.nightHours,
      ME: settings.morningEveningHours,
      O: 0,
    };

    if (schedule.assignments[pId]) {
      for (let d = 1; d <= daysInMonth; d++) {
        const s = schedule.assignments[pId][d];
        if (s && s !== 'O') {
          hours += shiftHours[s] || 0;
        }
      }
    }
    return hours;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans" dir="rtl">
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            className={`fixed top-4 left-4 right-4 md:left-auto md:right-4 z-50 p-4 rounded-xl shadow-lg border text-sm font-semibold flex items-center gap-3 max-w-md ${
              toast.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : toast.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-200'
                : 'bg-blue-50 text-blue-800 border-blue-200'
            }`}
          >
            {toast.type === 'success' ? (
              <Check className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            ) : toast.type === 'error' ? (
              <X className="w-5 h-5 text-rose-600 flex-shrink-0" />
            ) : (
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0" />
            )}
            <p className="leading-relaxed">{toast.message}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Header */}
      <header className="bg-gradient-to-r from-blue-700 to-indigo-800 text-white shadow-md print:hidden">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/10 rounded-xl backdrop-blur-md">
              <Sparkles className="w-6 h-6 text-cyan-300" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black tracking-tight flex items-center gap-2">
                سامانه هوشمند شیفت‌بندی پرستاران Sepehr
              </h1>
              <p className="text-xs text-blue-100">
                پشتیبانی از مدل‌های ذخیره‌سازی ابری S3 ایران (آروان‌کلود، لیارا) و لوکال
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Department Picker */}
            <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-xl border border-white/10">
              <span className="text-xs text-blue-200 font-bold whitespace-nowrap">بخش:</span>
              <select
                value={selectedDeptId}
                onChange={(e) => setSelectedDeptId(e.target.value)}
                className="bg-transparent text-white font-bold text-sm outline-none cursor-pointer"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id} className="text-slate-800">
                    {d.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setIsDeptModalOpen(true)}
                className="p-1 hover:bg-white/10 rounded-lg text-cyan-300"
                title="ایجاد بخش جدید"
              >
                <Plus className="w-4 h-4" />
              </button>
              {departments.length > 1 && (
                <button
                  onClick={() => setIsDeleteDeptConfirmOpen(true)}
                  className="p-1 hover:bg-rose-500/20 rounded-lg text-rose-300"
                  title="حذف این بخش"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Auth / Head Nurse Status */}
            {isAuthorized ? (
              <div className="flex items-center gap-2 bg-emerald-500/20 text-emerald-200 px-3 py-1.5 rounded-xl border border-emerald-500/30 text-sm font-semibold">
                <Unlock className="w-4 h-4" />
                <span>سرپرستار بخش</span>
                <button
                  onClick={() => {
                    setIsAuthorized(false);
                    showToast('با موفقیت خارج شدید.');
                  }}
                  className="p-1 hover:bg-white/10 rounded-lg text-rose-300"
                  title="خروج از پنل مدیریت"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition-all border border-cyan-400"
              >
                <Lock className="w-4 h-4" />
                <span>ورود سرپرستار (پسورد: ۱۲۳)</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* S3 Banner Indicator */}
      {!isS3Configured && (
        <div className="bg-amber-50 text-amber-800 border-b border-amber-200/60 px-4 py-2 flex items-center justify-between text-xs font-bold print:hidden">
          <span className="flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-600" />
            سیستم هم‌اکنون به دلیل عدم ورود متغیرهای S3 در حالت آفلاین لوکال (Local Storage) کار می‌کند. با تنظیم کلیدها به آروان‌کلود متصل شوید.
          </span>
          <span className="bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded border border-amber-300">
            ذخیره روی سرور لوکال فعال است
          </span>
        </div>
      )}

      {/* Navigation Tabs */}
      <nav className="bg-white border-b border-slate-200 print:hidden">
        <div className="max-w-7xl mx-auto px-4 md:px-6">
          <div className="flex gap-6 overflow-x-auto py-1">
            <button
              onClick={() => setActiveTab('schedule')}
              className={`flex items-center gap-2 py-3 px-1 border-b-2 font-bold text-sm transition-all whitespace-nowrap ${
                activeTab === 'schedule'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <CalendarIcon className="w-4 h-4" />
              برنامه زمان‌بندی ماهانه
            </button>
            <button
              onClick={() => setActiveTab('personnel')}
              className={`flex items-center gap-2 py-3 px-1 border-b-2 font-bold text-sm transition-all whitespace-nowrap ${
                activeTab === 'personnel'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Users className="w-4 h-4" />
              مدیریت پرسنل ({personnel.length})
            </button>
            <button
              onClick={() => setActiveTab('requests')}
              className={`flex items-center gap-2 py-3 px-1 border-b-2 font-bold text-sm transition-all whitespace-nowrap ${
                activeTab === 'requests'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <CheckSquare className="w-4 h-4" />
              درخواست‌های شیفت ({requests.length})
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-2 py-3 px-1 border-b-2 font-bold text-sm transition-all whitespace-nowrap ${
                activeTab === 'settings'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Settings className="w-4 h-4" />
              تنظیمات قوانین شیفت
            </button>
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 pb-20">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-500">
            <RefreshCw className="w-12 h-12 animate-spin text-blue-600 mb-4" />
            <span className="font-bold">در حال همگام‌سازی و بارگذاری اطلاعات...</span>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {activeTab === 'schedule' && (
              <motion.div
                key="schedule"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                {/* Year / Month Switcher & Auto solver controls */}
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200/80 flex flex-col md:flex-row items-center justify-between gap-4 print:hidden">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        if (currentMonth === 1) {
                          setCurrentMonth(12);
                          setCurrentYear(currentYear - 1);
                        } else {
                          setCurrentMonth(currentMonth - 1);
                        }
                      }}
                      className="p-2 hover:bg-slate-100 rounded-xl border border-slate-200 text-slate-600 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>

                    <div className="flex items-center gap-2 font-extrabold text-lg text-slate-800">
                      <CalendarIcon className="w-5 h-5 text-blue-600" />
                      <span>{JALALI_MONTH_NAMES[currentMonth - 1]}</span>
                      <span className="text-slate-400">{currentYear}</span>
                    </div>

                    <button
                      onClick={() => {
                        if (currentMonth === 12) {
                          setCurrentMonth(1);
                          setCurrentYear(currentYear + 1);
                        } else {
                          setCurrentMonth(currentMonth + 1);
                        }
                      }}
                      className="p-2 hover:bg-slate-100 rounded-xl border border-slate-200 text-slate-600 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2.5 flex-wrap">
                    {/* Finalized state indicator */}
                    {schedule.finalized ? (
                      <span className="px-3.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        برنامه تایید نهایی شده (قفل)
                      </span>
                    ) : (
                      <span className="px-3.5 py-1.5 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold flex items-center gap-1.5">
                        <Unlock className="w-3.5 h-3.5" />
                        در حال ویرایش و پیش‌نویس
                      </span>
                    )}

                    {/* Actions if authorized */}
                    {isAuthorized && (
                      <>
                        {!schedule.finalized ? (
                          <>
                            <button
                              onClick={handleAutoSchedule}
                              className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md transition-all border border-blue-500"
                            >
                              <Play className="w-4 h-4 fill-white" />
                              تنظیم هوشمند شیفت‌ها (هوش مصنوعی)
                            </button>
                            <button
                              onClick={handleClearSchedule}
                              className="flex items-center gap-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-3.5 py-2 rounded-xl text-sm font-bold transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                              پاک‌سازی جدول
                            </button>
                            <button
                              onClick={() => handleFinalizeSchedule(true)}
                              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl text-sm font-bold transition-all"
                            >
                              <Lock className="w-4 h-4" />
                              قفل و تایید نهایی
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleFinalizeSchedule(false)}
                            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-3.5 py-2 rounded-xl text-sm font-bold transition-all"
                          >
                            <Unlock className="w-4 h-4" />
                            باز کردن قفل برنامه
                          </button>
                        )}
                      </>
                    )}

                    <button
                      onClick={handlePrint}
                      className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 px-3.5 py-2 rounded-xl text-sm font-bold transition-all"
                    >
                      <Printer className="w-4 h-4" />
                      نسخه چاپی
                    </button>
                  </div>
                </div>

                {/* Holiday configuration row */}
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200/80 print:hidden">
                  <h3 className="text-sm font-black text-slate-800 mb-3 flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-rose-500" />
                    تعیین تعطیلات رسمی ماه (برای اعمال شیفت‌های عادلانه):
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: daysInMonth }).map((_, i) => {
                      const day = i + 1;
                      const isHoliday = holidays.includes(day);
                      return (
                        <button
                          key={day}
                          disabled={!isAuthorized || schedule.finalized}
                          onClick={() => handleToggleHoliday(day)}
                          className={`w-8 h-8 rounded-lg text-xs font-bold border transition-all flex items-center justify-center ${
                            isHoliday
                              ? 'bg-rose-500 text-white border-rose-600 shadow-sm'
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Alerts / Warnings list toggle */}
                {scheduleWarnings.length > 0 && (
                  <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 print:hidden">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 text-rose-800 font-bold text-sm">
                        <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 animate-pulse" />
                        <span>هشدارها و خطاهای قوانین کار ({scheduleWarnings.length} مورد یافت شد)</span>
                      </div>
                      <button
                        onClick={() => setShowWarningsList(!showWarningsList)}
                        className="text-xs text-rose-700 underline hover:text-rose-900 font-bold"
                      >
                        {showWarningsList ? 'پنهان کردن جزئیات' : 'مشاهده همه جزئیات'}
                      </button>
                    </div>
                    {showWarningsList && (
                      <ul className="mt-3 space-y-2 text-xs text-rose-700 font-medium list-disc list-inside">
                        {scheduleWarnings.map((warning, index) => (
                          <li key={index} className="leading-relaxed">{warning}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Main Schedule Grid Table */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
                  <div className="overflow-x-auto max-w-full">
                    <table className="w-full border-collapse text-right text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 font-bold text-slate-700">
                        <tr>
                          <th className="px-4 py-3 border-r border-slate-200 sticky right-0 bg-slate-50 shadow-[2px_0_5px_rgba(0,0,0,0.05)] w-48 min-w-[12rem] whitespace-nowrap">
                            نام پرسنل
                          </th>
                          {Array.from({ length: daysInMonth }).map((_, i) => {
                            const day = i + 1;
                            const isHoliday = holidays.includes(day);
                            return (
                              <th
                                key={day}
                                className={`px-2 py-3 border-r border-slate-200 text-center w-10 min-w-[2.5rem] ${
                                  isHoliday ? 'bg-rose-50 text-rose-600' : ''
                                }`}
                              >
                                <div>{day}</div>
                                <div className="text-[9px] text-slate-400 font-normal mt-0.5">
                                  {WEEKDAYS[(firstDayWeekday + i) % 7][0]}
                                </div>
                              </th>
                            );
                          })}
                          <th className="px-4 py-3 text-center border-l border-slate-200 whitespace-nowrap">
                            ساعت شیفت
                          </th>
                          <th className="px-4 py-3 text-center border-l border-slate-200 whitespace-nowrap">
                            موظفی
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {personnel.length === 0 ? (
                          <tr>
                            <td colSpan={daysInMonth + 3} className="px-6 py-12 text-center text-slate-400 font-semibold">
                              هیچ پرسنل فعالی در این بخش یافت نشد. لطفا در تب پرسنل اقدام به تعریف پرسنل کنید.
                            </td>
                          </tr>
                        ) : (
                          personnel.map((p) => {
                            const scheduledHours = getPersonnelScheduledHours(p.id);
                            const targetHours = p.conscript ? settings.conscriptMaxHours : p.targetWorkHours;
                            const isOverwork = p.conscript && scheduledHours > settings.conscriptMaxHours;
                            
                            return (
                              <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-4 py-3 border-r border-slate-200 sticky right-0 bg-white shadow-[2px_0_5px_rgba(0,0,0,0.02)] z-10">
                                  <div className="font-bold text-slate-800 whitespace-nowrap">
                                    {p.firstName} {p.lastName}
                                  </div>
                                  <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                                    <span className="bg-slate-100 text-slate-600 px-1 py-0.5 rounded">
                                      {p.role === 'head_nurse' ? 'سرپرستار' : p.role === 'nurse' ? 'پرستار' : 'کمک بهیار'}
                                    </span>
                                    {p.conscript && (
                                      <span className="bg-rose-50 text-rose-600 border border-rose-200 px-1 py-0.5 rounded font-black">
                                        طرحی
                                      </span>
                                    )}
                                  </div>
                                </td>
                                {Array.from({ length: daysInMonth }).map((_, i) => {
                                  const day = i + 1;
                                  const currentShift = (schedule.assignments[p.id] && schedule.assignments[p.id][day]) || '';

                                  return (
                                    <td
                                      key={day}
                                      className="p-1 border-r border-slate-200 text-center align-middle"
                                    >
                                      {isAuthorized && !schedule.finalized ? (
                                        <select
                                          value={currentShift}
                                          onChange={(e) => handleSetCellShift(p.id, day, e.target.value as ShiftType)}
                                          className={`w-full h-8 text-[11px] font-bold rounded-lg border text-center cursor-pointer outline-none transition-all appearance-none ${getShiftColorClass(
                                            currentShift
                                          )}`}
                                        >
                                          <option value="">-</option>
                                          <option value="M">صبح (M)</option>
                                          <option value="E">عصر (E)</option>
                                          <option value="N">شب (N)</option>
                                          <option value="ME">صبح-عصر</option>
                                          <option value="O">آف (O)</option>
                                        </select>
                                      ) : (
                                        <span
                                          className={`inline-flex w-full h-8 items-center justify-center font-bold border rounded-lg text-[11px] ${getShiftColorClass(
                                            currentShift
                                          )}`}
                                        >
                                          {currentShift || '-'}
                                        </span>
                                      )}
                                    </td>
                                  );
                                })}

                                <td className={`px-4 py-3 text-center border-l border-slate-200 font-bold ${
                                  isOverwork ? 'text-rose-600 bg-rose-50' : 'text-slate-800'
                                }`}>
                                  <div className="flex items-center justify-center gap-1">
                                    <span>{scheduledHours}</span>
                                    {isOverwork && (
                                      <span title="بیش از سقف مجاز طرحی!">
                                        <AlertTriangle className="w-3.5 h-3.5 text-rose-500 animate-bounce" />
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td className="px-4 py-3 text-center border-l border-slate-200 text-slate-500 font-semibold">
                                  {targetHours}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Print Layout (hidden on screen, visible on print) */}
                <div className="hidden print:block bg-white p-6 rounded-none text-black">
                  <h2 className="text-center text-lg font-black mb-1">
                    جدول برنامه زمان‌بندی شیفت‌های پرستاری بخش {departments.find(d => d.id === selectedDeptId)?.name}
                  </h2>
                  <p className="text-center text-xs text-slate-500 mb-6">
                    مربوط به ماه {JALALI_MONTH_NAMES[currentMonth - 1]} سال {currentYear}
                  </p>
                  
                  <table className="w-full border-collapse border border-black text-[10px]">
                    <thead>
                      <tr>
                        <th className="border border-black px-2 py-1 bg-slate-100 text-right w-36">نام پرسنل</th>
                        {Array.from({ length: daysInMonth }).map((_, i) => (
                          <th key={i} className="border border-black px-1 py-1 text-center bg-slate-50">{i + 1}</th>
                        ))}
                        <th className="border border-black px-1 py-1 text-center bg-slate-100 w-14">ساعت شیفت</th>
                      </tr>
                    </thead>
                    <tbody>
                      {personnel.map((p) => (
                        <tr key={p.id}>
                          <td className="border border-black px-2 py-1 font-bold">
                            {p.firstName} {p.lastName} {p.conscript ? '(طرحی)' : ''}
                          </td>
                          {Array.from({ length: daysInMonth }).map((_, i) => {
                            const day = i + 1;
                            const s = (schedule.assignments[p.id] && schedule.assignments[p.id][day]) || '';
                            return (
                              <td key={day} className="border border-black px-1 py-1 text-center font-bold">
                                {s || '-'}
                              </td>
                            );
                          })}
                          <td className="border border-black px-1 py-1 text-center font-bold">
                            {getPersonnelScheduledHours(p.id)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Shift hours helper card */}
                <div className="bg-slate-100 p-4 rounded-2xl border border-slate-200 text-xs text-slate-500 leading-relaxed grid grid-cols-2 md:grid-cols-5 gap-3 print:hidden">
                  <div className="flex items-center gap-2"><span className="w-3 h-3 bg-cyan-50 border border-cyan-200 rounded"></span> صبح (M): {settings.morningHours} ساعت</div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 bg-purple-50 border border-purple-200 rounded"></span> عصر (E): {settings.eveningHours} ساعت</div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 bg-indigo-900 border border-indigo-950 rounded"></span> شب (N): {settings.nightHours} ساعت</div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 bg-amber-100 border border-amber-300 rounded"></span> صبح-عصر (ME): {settings.morningEveningHours} ساعت</div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 bg-slate-100 border border-slate-200 rounded"></span> آف (O): ۰ ساعت</div>
                </div>
              </motion.div>
            )}

            {activeTab === 'personnel' && (
              <motion.div
                key="personnel"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-black text-slate-800">لیست و مدیریت کادر درمان بخش</h2>
                    <p className="text-xs text-slate-500 mt-1">تعداد پرسنل ثبت شده: {personnel.length} نفر</p>
                  </div>
                  {isAuthorized && (
                    <button
                      onClick={() => {
                        setEditingPersonnel({ active: true, contractType: 'official', role: 'nurse', gender: 'female' });
                        setIsPersonnelModalOpen(true);
                      }}
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-sm transition-all"
                    >
                      <UserPlus className="w-4 h-4" />
                      افزودن پرسنل جدید
                    </button>
                  )}
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {personnel.map((p) => (
                    <div
                      key={p.id}
                      className={`bg-white p-5 rounded-2xl border transition-all ${
                        p.active ? 'border-slate-200/80 shadow-sm' : 'border-slate-200 bg-slate-100/50 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-extrabold text-base text-slate-800">
                            {p.firstName} {p.lastName}
                          </h3>
                          <p className="text-xs text-slate-400 mt-1">{p.email || 'بدون ایمیل'}</p>
                        </div>
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                          p.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}>
                          {p.active ? 'فعال' : 'غیرفعال'}
                        </span>
                      </div>

                      <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-y-2 text-xs text-slate-600">
                        <div>
                          <span className="text-slate-400 block mb-0.5">سمت شغلی:</span>
                          <span className="font-bold">
                            {p.role === 'head_nurse' ? 'سرپرستار' : p.role === 'nurse' ? 'پرستار' : p.role === 'assistant' ? 'کمک‌بهیار' : 'خدمات'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block mb-0.5">نوع قرارداد:</span>
                          <span className="font-bold">
                            {p.contractType === 'official' ? 'رسمی' : p.contractType === 'contractual' ? 'قراردادی' : p.contractType === 'conscript' ? 'طرحی' : 'ساعتی'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block mb-0.5">موظفی در ماه:</span>
                          <span className="font-bold">{p.conscript ? settings.conscriptMaxHours : p.targetWorkHours} ساعت</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block mb-0.5">شماره تماس:</span>
                          <span className="font-bold">{p.phone || '-'}</span>
                        </div>
                      </div>

                      {isAuthorized && (
                        <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
                          <button
                            onClick={() => {
                              setEditingPersonnel(p);
                              setIsPersonnelModalOpen(true);
                            }}
                            className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            ویرایش
                          </button>
                          <button
                            onClick={() => handleDeletePersonnel(p.id)}
                            className="flex items-center gap-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            حذف
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'requests' && (
              <motion.div
                key="requests"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-black text-slate-800">درخواست‌های مرخصی و شیفت پرسنل</h2>
                    <p className="text-xs text-slate-500 mt-1">
                      درخواست‌های ثبت‌شده توسط پرسنل یا به صورت دستی توسط سرپرستار
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setNewRequest({
                        personnelId: personnel[0]?.id || '',
                        type: 'off',
                        shiftType: 'M',
                        status: 'pending',
                        date: `${currentYear}_${String(currentMonth).padStart(2, '0')}_01`
                      });
                      setIsRequestModalOpen(true);
                    }}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-sm transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    ثبت درخواست جدید
                  </button>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 font-bold text-slate-700">
                      <tr>
                        <th className="px-6 py-3.5">نام پرسنل</th>
                        <th className="px-6 py-3.5">تاریخ درخواستی (جلالی)</th>
                        <th className="px-6 py-3.5">نوع درخواست</th>
                        <th className="px-6 py-3.5">جزئیات شیفت</th>
                        <th className="px-6 py-3.5">توضیحات و علت</th>
                        <th className="px-6 py-3.5">وضعیت</th>
                        {isAuthorized && <th className="px-6 py-3.5 text-center">عملیات مدیریت</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {requests.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-6 py-12 text-center text-slate-400 font-semibold">
                            هیچ درخواستی ثبت نشده است.
                          </td>
                        </tr>
                      ) : (
                        requests.map((r) => {
                          const p = personnel.find((person) => person.id === r.personnelId);
                          return (
                            <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-6 py-4 font-bold text-slate-800">
                                {p ? `${p.firstName} ${p.lastName}` : 'پرسنل حذف شده'}
                              </td>
                              <td className="px-6 py-4 font-bold font-mono text-slate-600">
                                {r.date.replace(/_/g, '/')}
                              </td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  r.type === 'off' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                                }`}>
                                  {r.type === 'off' ? 'مرخصی (آف)' : 'درخواست شیفت خاص'}
                                </span>
                              </td>
                              <td className="px-6 py-4 font-bold text-slate-700">
                                {r.type === 'shift' && r.shiftType ? getShiftLabel(r.shiftType) : '-'}
                              </td>
                              <td className="px-6 py-4 text-slate-500 leading-relaxed max-w-xs truncate">
                                {r.reason || 'بدون توضیح'}
                              </td>
                              <td className="px-6 py-4">
                                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                                  r.status === 'approved'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : r.status === 'rejected'
                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                    : 'bg-amber-50 text-amber-700 border-amber-200'
                                }`}>
                                  {r.status === 'approved' ? 'تایید شده' : r.status === 'rejected' ? 'رد شده' : 'در انتظار بررسی'}
                                </span>
                              </td>
                              {isAuthorized && (
                                <td className="px-6 py-4">
                                  <div className="flex items-center justify-center gap-2">
                                    {r.status === 'pending' && (
                                      <>
                                        <button
                                          onClick={() => handleUpdateRequestStatus(r.id, 'approved')}
                                          className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg border border-emerald-200 transition-colors"
                                          title="تایید درخواست"
                                        >
                                          <Check className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={() => handleUpdateRequestStatus(r.id, 'rejected')}
                                          className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg border border-rose-200 transition-colors"
                                          title="رد درخواست"
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </>
                                    )}
                                    <button
                                      onClick={() => handleDeleteRequest(r.id)}
                                      className="p-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg border border-slate-200 transition-colors"
                                      title="حذف تاریخچه درخواست"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 space-y-6"
              >
                <div>
                  <h2 className="text-xl font-black text-slate-800">تنظیمات قوانین شیفت‌بندی بخش</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    قوانین و موظفی‌های قانونی برای شیفت‌های کاری این بخش
                  </p>
                </div>

                {!isAuthorized ? (
                  <div className="bg-amber-50 p-6 rounded-xl border border-amber-200/60 text-center space-y-3">
                    <Lock className="w-8 h-8 text-amber-600 mx-auto" />
                    <p className="text-sm font-bold text-amber-900">دسترسی به تنظیمات بخش قفل است</p>
                    <p className="text-xs text-amber-700 leading-relaxed">
                      برای تغییر ساعات موظفی کادر درمان یا قانون سقف کارانه پرستاران طرحی، ابتدا از بالای صفحه به عنوان سرپرستار وارد شوید.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSaveSettings} className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-black text-slate-600 mb-1.5">ساعت شیفت صبح (M)</label>
                        <input
                          type="number"
                          step="0.1"
                          required
                          value={settings.morningHours}
                          onChange={(e) => setSettings({ ...settings, morningHours: Number(e.target.value) })}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-black text-slate-600 mb-1.5">ساعت شیفت عصر (E)</label>
                        <input
                          type="number"
                          step="0.1"
                          required
                          value={settings.eveningHours}
                          onChange={(e) => setSettings({ ...settings, eveningHours: Number(e.target.value) })}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-black text-slate-600 mb-1.5">ساعت شیفت شب (N)</label>
                        <input
                          type="number"
                          step="0.1"
                          required
                          value={settings.nightHours}
                          onChange={(e) => setSettings({ ...settings, nightHours: Number(e.target.value) })}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-black text-slate-600 mb-1.5">ساعت شیفت صبح-عصر (ME)</label>
                        <input
                          type="number"
                          step="0.1"
                          required
                          value={settings.morningEveningHours}
                          onChange={(e) => setSettings({ ...settings, morningEveningHours: Number(e.target.value) })}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                        />
                      </div>
                    </div>

                    <div className="border-t border-slate-100 pt-4 space-y-4">
                      <div>
                        <label className="block text-xs font-black text-slate-600 mb-1.5">سقف مجاز کارانه پرسنل طرحی (در ماه)</label>
                        <input
                          type="number"
                          required
                          value={settings.conscriptMaxHours}
                          onChange={(e) => setSettings({ ...settings, conscriptMaxHours: Number(e.target.value) })}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                        />
                        <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                          محدودیت قانونی سقف اضافه کار نیروهای ترحیم (طرحی) کشور. الگوریتم حل هوشمند از تخصیص شیفت مازاد بر این عدد جلوگیری خواهد کرد.
                        </p>
                      </div>

                      <div>
                        <label className="block text-xs font-black text-slate-600 mb-1.5">ساعت موظفی پرسنل رسمی / قراردادی (در ماه)</label>
                        <input
                          type="number"
                          required
                          value={settings.targetWorkHours}
                          onChange={(e) => setSettings({ ...settings, targetWorkHours: Number(e.target.value) })}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-2.5 rounded-xl shadow-md transition-all text-sm"
                    >
                      ذخیره تنظیمات بخش
                    </button>
                  </form>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </main>

      {/* Creation of Department Modal */}
      {isDeptModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
          >
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-800">ایجاد بخش (بخش بیمارستانی جدید)</h3>
              <button onClick={() => setIsDeptModalOpen(false)} className="p-1 hover:bg-slate-200 rounded-lg">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreateDepartment} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نام بخش (مثلاً بخش اورژانس باوند)</label>
                <input
                  type="text"
                  required
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm focus:ring-2 focus:ring-blue-500"
                  placeholder="بخش جراحی، ICU قلب و..."
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نام کاربری سرپرستار این بخش</label>
                <input
                  type="text"
                  required
                  value={newDeptUsername}
                  onChange={(e) => setNewDeptUsername(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm focus:ring-2 focus:ring-blue-500 text-left"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">رمز عبور مدیریت بخش</label>
                <input
                  type="password"
                  required
                  value={newDeptPassword}
                  onChange={(e) => setNewDeptPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm focus:ring-2 focus:ring-blue-500 text-left"
                  dir="ltr"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-2.5 rounded-xl shadow-md transition-all text-sm"
              >
                ثبت بخش جدید و ورود به آن
              </button>
            </form>
          </motion.div>
        </div>
      )}

      {/* Delete Department Confirmation Modal */}
      {isDeleteDeptConfirmOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-sans">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
          >
            <div className="px-6 py-4 bg-rose-50 border-b border-rose-100 flex items-center justify-between text-rose-800">
              <h3 className="text-base font-black flex items-center gap-1.5">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
                تایید هویت برای حذف کامل بخش
              </h3>
              <button onClick={() => setIsDeleteDeptConfirmOpen(false)} className="p-1 hover:bg-rose-100 rounded-lg">
                <X className="w-5 h-5 text-rose-400" />
              </button>
            </div>
            <form onSubmit={handleDeleteDepartment} className="p-6 space-y-4">
              <div className="bg-rose-50/50 text-rose-700 text-xs p-3 rounded-xl border border-rose-100 leading-relaxed font-semibold">
                هشدار: شما در حال حذف کامل بخش «{departments.find((d) => d.id === selectedDeptId)?.name}» هستید. این عملیات غیر قابل بازگشت است. برای تایید نام کاربری و پسورد سرپرستار این بخش را وارد کنید.
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نام کاربری سرپرستار</label>
                <input
                  type="text"
                  required
                  value={deleteDeptUsername}
                  onChange={(e) => setDeleteDeptUsername(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm text-left"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">رمز عبور مدیریت</label>
                <input
                  type="password"
                  required
                  value={deleteDeptPassword}
                  onChange={(e) => setDeleteDeptPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm text-left"
                  dir="ltr"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold py-2 rounded-xl text-sm"
                >
                  حذف کامل بخش
                </button>
                <button
                  type="button"
                  onClick={() => setIsDeleteDeptConfirmOpen(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold py-2 rounded-xl text-sm border border-slate-200"
                >
                  انصراف
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Auth Modal */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
          >
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-800">احراز هویت سرپرستار بخش</h3>
              <button onClick={() => setIsAuthModalOpen(false)} className="p-1 hover:bg-slate-200 rounded-lg">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleAuthLogin} className="p-6 space-y-4">
              {authError && (
                <div className="bg-rose-50 text-rose-700 border border-rose-200 text-xs p-3 rounded-xl font-bold">
                  {authError}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نام کاربری مدیریت</label>
                <input
                  type="text"
                  required
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm text-left"
                  dir="ltr"
                  placeholder="مثال: sepehr_head"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">رمز عبور</label>
                <input
                  type="password"
                  required
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm text-left"
                  dir="ltr"
                  placeholder="پسورد پیشفرض: 123"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-2.5 rounded-xl shadow-md transition-all text-sm"
              >
                ورود به پنل مدیریت شیفت‌ها
              </button>
            </form>
          </motion.div>
        </div>
      )}

      {/* Personnel Manage Modal */}
      {isPersonnelModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden"
          >
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-800">
                {editingPersonnel.id ? 'ویرایش اطلاعات پرسنل بخش' : 'تعریف پرسنل جدید'}
              </h3>
              <button onClick={() => setIsPersonnelModalOpen(false)} className="p-1 hover:bg-slate-200 rounded-lg">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleSavePersonnel} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">نام</label>
                  <input
                    type="text"
                    required
                    value={editingPersonnel.firstName || ''}
                    onChange={(e) => setEditingPersonnel({ ...editingPersonnel, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">نام خانوادگی</label>
                  <input
                    type="text"
                    required
                    value={editingPersonnel.lastName || ''}
                    onChange={(e) => setEditingPersonnel({ ...editingPersonnel, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سمت کادر درمان</label>
                  <select
                    value={editingPersonnel.role || 'nurse'}
                    onChange={(e) => setEditingPersonnel({ ...editingPersonnel, role: e.target.value as PersonnelRole })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="nurse">پرستار (Nurse)</option>
                    <option value="head_nurse">سرپرستار (Head Nurse)</option>
                    <option value="assistant">کمک بهیار</option>
                    <option value="service">کادر خدمات</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">نوع استخدام / قرارداد</label>
                  <select
                    value={editingPersonnel.contractType || 'official'}
                    onChange={(e) => setEditingPersonnel({ ...editingPersonnel, contractType: e.target.value as ContractType })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="official">رسمی</option>
                    <option value="contractual">قراردادی</option>
                    <option value="conscript">طرحی (Conscript)</option>
                    <option value="hourly">ساعتی / شرکتی</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">جنسیت</label>
                  <select
                    value={editingPersonnel.gender || 'female'}
                    onChange={(e) => setEditingPersonnel({ ...editingPersonnel, gender: e.target.value as GenderType })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="female">زن</option>
                    <option value="male">مرد</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ساعت موظفی در ماه</label>
                  <input
                    type="number"
                    required
                    value={editingPersonnel.targetWorkHours || 160}
                    onChange={(e) => setEditingPersonnel({ ...editingPersonnel, targetWorkHours: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">شماره تلفن تماس</label>
                  <input
                    type="tel"
                    value={editingPersonnel.phone || ''}
                    onChange={(e) => setEditingPersonnel({ ...editingPersonnel, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm text-left focus:ring-2 focus:ring-blue-500"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ایمیل پرسنلی</label>
                  <input
                    type="email"
                    value={editingPersonnel.email || ''}
                    onChange={(e) => setEditingPersonnel({ ...editingPersonnel, email: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm text-left focus:ring-2 focus:ring-blue-500"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={editingPersonnel.active !== false}
                  onChange={(e) => setEditingPersonnel({ ...editingPersonnel, active: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="active" className="text-xs font-bold text-slate-700">پرسنل فعال در بخش (تخصیص شیفت فعال باشد)</label>
              </div>

              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-2.5 rounded-xl shadow-md transition-all text-sm"
              >
                ذخیره اطلاعات پرسنلی
              </button>
            </form>
          </motion.div>
        </div>
      )}

      {/* Register Request Modal */}
      {isRequestModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95"
          >
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-800">ثبت درخواست جدید کادر درمان</h3>
              <button onClick={() => setIsRequestModalOpen(false)} className="p-1 hover:bg-slate-200 rounded-lg">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleSaveRequest} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">انتخاب کادر درمان</label>
                <select
                  value={newRequest.personnelId}
                  onChange={(e) => setNewRequest({ ...newRequest, personnelId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">انتخاب کنید...</option>
                  {personnel.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">تاریخ (جلالی)</label>
                  <input
                    type="text"
                    required
                    value={newRequest.date || ''}
                    onChange={(e) => setNewRequest({ ...newRequest, date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm text-center"
                    placeholder="1405_04_15"
                    dir="ltr"
                  />
                  <p className="text-[9px] text-slate-400 mt-0.5">فرمت: YYYY_MM_DD</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">نوع درخواست</label>
                  <select
                    value={newRequest.type || 'off'}
                    onChange={(e) => setNewRequest({ ...newRequest, type: e.target.value as any })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm"
                  >
                    <option value="off">درخواست مرخصی (آف)</option>
                    <option value="shift">درخواست شیفت خاص</option>
                  </select>
                </div>
              </div>

              {newRequest.type === 'shift' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">نوع شیفت خاص درخواستی</label>
                  <select
                    value={newRequest.shiftType || 'M'}
                    onChange={(e) => setNewRequest({ ...newRequest, shiftType: e.target.value as any })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm"
                  >
                    <option value="M">صبح (M)</option>
                    <option value="E">عصر (E)</option>
                    <option value="N">شب (N)</option>
                    <option value="ME">صبح-عصر (ME)</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">علت یا توضیحات</label>
                <textarea
                  value={newRequest.reason || ''}
                  onChange={(e) => setNewRequest({ ...newRequest, reason: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none text-sm focus:ring-2 focus:ring-blue-500 h-20 resize-none"
                  placeholder="مثال: شرکت در سمینار علمی، مرخصی استعلاجی و..."
                />
              </div>

              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-2.5 rounded-xl shadow-md transition-all text-sm"
              >
                ثبت درخواست پرسنلی
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
