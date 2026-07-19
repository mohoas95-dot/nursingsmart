import { redirect } from 'next/navigation';
import { ChangePasswordForm } from '../components/auth/ChangePasswordForm';
import { getCurrentUser } from '../../lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-5" dir="rtl">
      <ChangePasswordForm isRequired={user.mustChangePassword} />
    </main>
  );
}
