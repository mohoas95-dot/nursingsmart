'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';

const DISPLAY_DURATION_MS = 3000;
const EXIT_DURATION_MS = 250;

export function WelcomeOverlay({
  firstName,
  lastName,
  onComplete,
}: {
  firstName: string;
  lastName: string;
  onComplete: () => void;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const fadeTimer = window.setTimeout(() => setVisible(false), DISPLAY_DURATION_MS - EXIT_DURATION_MS);
    const redirectTimer = window.setTimeout(onComplete, DISPLAY_DURATION_MS);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(redirectTimer);
    };
  }, [onComplete]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 p-5 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: EXIT_DURATION_MS / 1000, ease: 'easeInOut' }}
          role="status"
          aria-live="polite"
          dir="rtl"
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="w-full max-w-xl rounded-[2rem] border border-white/60 bg-white/90 p-8 text-center shadow-2xl sm:p-12"
          >
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg">
              <Sparkles className="h-8 w-8" aria-hidden="true" />
            </div>
            <p className="text-xl font-black leading-10 text-slate-900 sm:text-3xl">
              {firstName} {lastName} عزیز، خوش آمدید
            </p>
            <p className="mt-3 text-xs font-bold text-slate-500">در حال آماده‌سازی محیط کاربری شما...</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
