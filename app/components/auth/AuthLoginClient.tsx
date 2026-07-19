'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoginResult } from '../../../lib/auth/types';
import { LoginForm } from './LoginForm';
import { WelcomeOverlay } from './WelcomeOverlay';

export function AuthLoginClient() {
  const router = useRouter();
  const [loginResult, setLoginResult] = useState<LoginResult | null>(null);
  const finishWelcome = useCallback(() => {
    if (loginResult) router.replace(loginResult.redirectTo);
  }, [loginResult, router]);

  return (
    <>
      <LoginForm onSuccess={setLoginResult} />
      {loginResult && (
        <WelcomeOverlay
          firstName={loginResult.user.firstName}
          lastName={loginResult.user.lastName}
          onComplete={finishWelcome}
        />
      )}
    </>
  );
}
