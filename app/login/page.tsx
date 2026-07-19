import { redirect } from 'next/navigation';
import { AuthLoginClient } from '../components/auth/AuthLoginClient';
import { getCurrentUser } from '../../lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.mustChangePassword ? '/change-password' : '/');

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-100 p-5" dir="rtl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(79,70,229,0.14),transparent_35%)]" />
      <div className="relative z-10 flex w-full justify-center"><AuthLoginClient /></div>
    </main>
  );
}
