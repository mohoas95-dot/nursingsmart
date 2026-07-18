'use client';

import { Dispatch, SetStateAction, useCallback, useEffect, useState } from 'react';
import { fetchOfficialMonth, OfficialMonth } from '../lib/calendar/service';

function currentTehranJalali() {
  const parts = new Intl.DateTimeFormat('fa-IR-u-nu-latn', { year: 'numeric', month: 'numeric', timeZone: 'Asia/Tehran' }).format(new Date()).split('/');
  return { year: Number(parts[0]), month: Number(parts[1]) };
}

export function useOfficialCalendar() {
  const current = currentTehranJalali();
  const [year, setYearState] = useState(current.year);
  const [month, setMonthState] = useState(current.month);
  const [calendar, setCalendar] = useState<OfficialMonth | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const setYear: Dispatch<SetStateAction<number>> = useCallback(action => {
    setYearState(previous => {
      const next = typeof action === 'function' ? action(previous) : action;
      localStorage.setItem('hospital_current_year', String(next));
      return next;
    });
  }, []);
  const setMonth: Dispatch<SetStateAction<number>> = useCallback(action => {
    setMonthState(previous => {
      const next = typeof action === 'function' ? action(previous) : action;
      localStorage.setItem('hospital_current_month', String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const savedYear = Number(localStorage.getItem('hospital_current_year'));
    const savedMonth = Number(localStorage.getItem('hospital_current_month'));
    if (savedYear >= 1300 && savedYear <= 1500) setYearState(savedYear);
    if (savedMonth >= 1 && savedMonth <= 12) setMonthState(savedMonth);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    setCalendar(null); // جلوگیری از نمایش ماه قبلی زیر عنوان ماه جدید
    let timer: ReturnType<typeof setTimeout>;
    const load = async (attempt = 0) => {
      try {
        const result = await fetchOfficialMonth(year, month, controller.signal);
        setCalendar(result);
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted && attempt < 3) timer = setTimeout(() => load(attempt + 1), 2000 * (attempt + 1));
        else if (!controller.signal.aborted) setStatus('error');
      }
    };
    load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [year, month]);

  const goToNextMonth = useCallback(() => {
    if (month === 12) { setYear(year + 1); setMonth(1); } else setMonth(month + 1);
  }, [month, year, setMonth, setYear]);
  const goToPreviousMonth = useCallback(() => {
    if (month === 1) { setYear(year - 1); setMonth(12); } else setMonth(month - 1);
  }, [month, year, setMonth, setYear]);

  return { year, month, setYear, setMonth, goToNextMonth, goToPreviousMonth, calendar, status };
}
