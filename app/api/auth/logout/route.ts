import { NextRequest } from 'next/server';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../lib/auth/http';
import { destroyCurrentSession } from '../../../../lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await destroyCurrentSession();
    return authJson({ success: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
