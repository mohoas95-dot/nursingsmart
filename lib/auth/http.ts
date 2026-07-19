import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthenticationError } from './session';

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') throw new AuthenticationError(403, 'درخواست غیرمجاز است.');
  if (origin && new URL(origin).host !== request.nextUrl.host) {
    throw new AuthenticationError(403, 'مبدأ درخواست معتبر نیست.');
  }
}

export function authJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthenticationError) {
    return authJson({ success: false, error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return authJson({
      success: false,
      error: error.issues[0]?.message || 'اطلاعات واردشده معتبر نیست.',
      issues: error.issues,
    }, { status: 400 });
  }
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
    return authJson({ success: false, error: 'این کد ملی قبلاً ثبت شده است.' }, { status: 409 });
  }
  console.error('Authentication API error:', error);
  return authJson({ success: false, error: 'خطای داخلی سرور؛ دوباره تلاش کنید.' }, { status: 500 });
}
