import { authErrorResponse, authJson } from '../../../../lib/auth/http';
import { getCurrentUser } from '../../../../lib/auth/session';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return authJson({ success: false, user: null }, { status: 401 });
    return authJson({ success: true, user });
  } catch (error) {
    return authErrorResponse(error);
  }
}
