import { HttpError } from './http.ts';
import type { FirebaseFetch } from './types.ts';

const unavailable = () => new HttpError(503, 'PROVIDER_UNAVAILABLE', 'Não foi possível concluir a solicitação agora. Tente novamente.');

export async function firebaseRequest(operation: 'sendOobCode' | 'resetPassword', payload: object, apiKey: string, transport: FirebaseFetch = fetch): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await transport(`https://identitytoolkit.googleapis.com/v1/accounts:${operation}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Firebase-Locale': 'pt-BR' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'manual',
    });
    const body: unknown = await response.json();
    if (response.ok) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || 'error' in body) throw unavailable();
      // A proteção contra enumeração pode omitir o e-mail na solicitação.
      if (operation === 'resetPassword' && (!('email' in body) || typeof body.email !== 'string')) throw unavailable();
      return;
    }
    if (response.status >= 500) throw unavailable();
    const error = body && typeof body === 'object' && 'error' in body ? body.error : null;
    const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '';
    const code = message.split(/[ :]/)[0];
    if (operation === 'sendOobCode' && ['EMAIL_NOT_FOUND', 'USER_DISABLED'].includes(code ?? '')) return;
    if (operation === 'resetPassword' && ['INVALID_OOB_CODE', 'EXPIRED_OOB_CODE', 'EMAIL_NOT_FOUND', 'USER_DISABLED'].includes(code ?? '')) {
      throw new HttpError(400, 'INVALID_OR_EXPIRED_CODE', 'O link de recuperação é inválido ou expirou. Solicite um novo.');
    }
    if (operation === 'resetPassword' && ['WEAK_PASSWORD', 'PASSWORD_DOES_NOT_MEET_REQUIREMENTS', 'MISSING_PASSWORD'].includes(code ?? '')) {
      throw new HttpError(400, 'INVALID_PASSWORD', 'A senha não atende à política de segurança da conta. Escolha outra senha.');
    }
    // Limites do provedor podem depender da conta; não expor isso como erro de e-mail.
    throw unavailable();
  } catch (error: unknown) {
    if (error instanceof HttpError) throw error;
    throw unavailable();
  } finally { clearTimeout(timeout); }
}
