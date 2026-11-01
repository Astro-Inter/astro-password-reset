import { HttpError } from './http.ts';

// Somente códigos conhecidos: nunca transportar mensagens brutas do provedor.
const firebaseCodes = new Set(['TOO_MANY_ATTEMPTS_TRY_LATER', 'QUOTA_EXCEEDED',
  'PERMISSION_DENIED', 'INSUFFICIENT_PERMISSION', 'INVALID_API_KEY', 'API_KEY_INVALID',
  'PROJECT_NOT_FOUND', 'CONFIGURATION_NOT_FOUND', 'OPERATION_NOT_ALLOWED']);

export function firebaseFailure(status: number, body: unknown): HttpError {
  const error = body && typeof body === 'object' && 'error' in body ? body.error : null;
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message.split(/[ :]/)[0] : '';
  const reason = firebaseCodes.has(message ?? '') ? message! : `HTTP_${status}`;
  const configuration = ['PERMISSION_DENIED', 'INSUFFICIENT_PERMISSION', 'INVALID_API_KEY', 'API_KEY_INVALID', 'PROJECT_NOT_FOUND', 'CONFIGURATION_NOT_FOUND', 'OPERATION_NOT_ALLOWED'].includes(reason);
  // Limites podem depender da conta: o cliente recebe indisponibilidade genérica.
  return Object.assign(new HttpError(503, configuration ? 'FIREBASE_CONFIGURATION_ERROR' : 'FIREBASE_UNAVAILABLE',
    configuration ? 'A integração com o serviço de autenticação precisa de configuração. Contate o suporte.' : 'Não foi possível concluir a operação no serviço de autenticação. Tente novamente mais tarde.'),
  { cause: Object.assign(new Error('Firebase request rejected'), { code: `FIREBASE_${reason}` }) });
}

export function dependencyFailure(code: string, message: string, cause?: unknown): HttpError {
  return Object.assign(new HttpError(503, code, message), { cause });
}
