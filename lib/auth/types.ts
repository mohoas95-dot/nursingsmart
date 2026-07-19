export type AuthenticatedUser = {
  id: string;
  nationalId: string;
  firstName: string;
  lastName: string;
  role: 'ADMIN' | 'HEAD_NURSE' | 'PERSONNEL';
  departmentId: string | null;
  personnelId: string | null;
  mustChangePassword: boolean;
};

export type LoginResult = {
  user: AuthenticatedUser;
  redirectTo: string;
};
