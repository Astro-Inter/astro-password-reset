import { configuration } from './config.ts';
import { firebaseRequest } from './firebase.ts';
import { errorResponse, HttpError, json, readPayload } from './http.ts';
import type { FirebaseFetch, WorkerEnv } from './types.ts';
import { recoveryEmail, replacement } from './validation.ts';
import { sendRecoveryEmail } from './recovery-email.ts';

export const recoveryMessage = 'Se o e-mail informado estiver cadastrado, você receberá instruções para redefinir sua senha.';

export async function handleRequest(request: Request, env: WorkerEnv, transport: FirebaseFetch = fetch): Promise<Response> {
  const headers = new Headers({ Vary: 'Origin' });
  try {
    const { origins, production } = configuration(env);
    const url = new URL(request.url);
    if (production && url.protocol !== 'https:') throw new HttpError(400, 'HTTPS_REQUIRED', 'Utilize HTTPS.');
    const origin = request.headers.get('Origin');
    if (origin && !origins.has(origin)) throw new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Origem não autorizada.');
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    if (!['/auth/forgot-password', '/auth/reset-password'].includes(url.pathname)) throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada.');
    if (request.method === 'OPTIONS') {
      if (request.headers.get('Access-Control-Request-Method') !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Utilize POST.');
      const requested = (request.headers.get('Access-Control-Request-Headers') ?? '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      if (requested.some(value => value !== 'content-type')) throw new HttpError(403, 'HEADERS_NOT_ALLOWED', 'Cabeçalho não autorizado.');
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
      headers.set('Access-Control-Max-Age', '600');
      headers.set('Cache-Control', 'no-store');
      headers.set('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') {
      headers.set('Allow', 'POST, OPTIONS');
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Utilize POST.');
    }
    // CF-Connecting-IP é definido pela Cloudflare; X-Forwarded-For não é confiável.
    const ip = request.headers.get('CF-Connecting-IP') ?? (production ? null : 'local-development');
    if (!ip) throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'Serviço temporariamente indisponível. Tente novamente.');
    const allowed = await env.PASSWORD_RATE_LIMITER.limit({ key: `password-reset:${ip}` });
    if (!allowed.success) throw new HttpError(429, 'RATE_LIMITED', 'Muitas solicitações. Aguarde um minuto e tente novamente.');
    const payload = await readPayload(request);
    if (url.pathname === '/auth/forgot-password') {
      const email = recoveryEmail(payload);
      if (env.EMAIL_DELIVERY_MODE === 'sendgrid') await sendRecoveryEmail(email, env, transport);
      else await firebaseRequest('sendOobCode', { requestType: 'PASSWORD_RESET', email }, env.FIREBASE_API_KEY, transport);
      return json({ success: true, message: recoveryMessage }, 200, headers);
    }
    await firebaseRequest('resetPassword', replacement(payload), env.FIREBASE_API_KEY, transport);
    return json({ success: true, message: 'Senha alterada com sucesso.' }, 200, headers);
  } catch (error: unknown) { return errorResponse(error, headers); }
}

