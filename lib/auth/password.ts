import 'server-only';
import bcrypt from 'bcryptjs';

export const DEFAULT_INITIAL_PASSWORD = '1234';
const BCRYPT_COST = 12;
const DUMMY_PASSWORD_HASH = '$2b$12$K1mnEGZv2BCsLoh2f.PI4ecUS7LL8D0M4pD8B9ievDo1NqbAbAfUK';

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, passwordHash?: string | null) {
  return bcrypt.compare(password, passwordHash || DUMMY_PASSWORD_HASH);
}
