import { HttpError } from './http.ts';
import type { WorkerEnv } from './types.ts';

export function configuration(env: WorkerEnv): { origins: Set<string>; production: boolean } {
  const unavailable = () => new HttpError(503, 'SERVICE_UNAVAILABLE', 'Serviço temporariamente indisponível. Tente novamente.');
  if (!['development', 'production'].includes(env.APP_ENV)) throw unavailable();
  const production = env.APP_ENV === 'production';
  if (env.EMAIL_DELIVERY_MODE && !['native', 'smtp'].includes(env.EMAIL_DELIVERY_MODE)) throw unavailable();
  const origins = new Set((env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean));
  if (!origins.size) throw unavailable();
  try {
    for (const origin of origins) {
      const url = new URL(origin);
      if (url.origin !== origin || url.username || url.password ||
        (url.protocol !== 'https:' && !( !production && ['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:'))) throw unavailable();
    }
    const frontend = new URL(env.FRONTEND_BASE_URL);
    if (!origins.has(frontend.origin) || frontend.search || frontend.hash || frontend.username || frontend.password) throw unavailable();
  } catch { throw unavailable(); }
  if (!env.FIREBASE_API_KEY?.trim() || typeof env.PASSWORD_RATE_LIMITER?.limit !== 'function') throw unavailable();
  return { origins, production };
}
