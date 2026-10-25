import { HttpError } from './http.ts';

export function recoveryEmail(payload: Record<string, unknown>): string {
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const local = email.slice(0, email.lastIndexOf('@'));
  if (!email || email.length > 254 || local.length > 64 || !/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(email)) {
    throw new HttpError(400, 'INVALID_EMAIL', 'Informe um e-mail válido com até 254 caracteres.');
  }
  return email;
}

export function replacement(payload: Record<string, unknown>): { oobCode: string; newPassword: string } {
  if (typeof payload.oobCode !== 'string' || !payload.oobCode.trim() || payload.oobCode.length > 2048 || /\s/.test(payload.oobCode)) {
    throw new HttpError(400, 'INVALID_OR_EXPIRED_CODE', 'O link de recuperação é inválido ou expirou. Solicite um novo.');
  }
  if (typeof payload.newPassword !== 'string' || payload.newPassword.length < 6 || payload.newPassword.length > 4096) {
    throw new HttpError(400, 'INVALID_PASSWORD', 'A senha deve conter entre 6 e 4096 caracteres e atender à política da conta.');
  }
  return { oobCode: payload.oobCode, newPassword: payload.newPassword };
}
