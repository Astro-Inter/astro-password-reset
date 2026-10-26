import { importPKCS8, SignJWT } from 'jose';
import { HttpError } from './http.ts';
import type { FirebaseFetch, WorkerEnv } from './types.ts';

export async function googleAccessToken(env: WorkerEnv, transport: FirebaseFetch, signal: AbortSignal): Promise<string> {
  try {
    if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) throw new Error('MISSING_CONFIG');
    const key = await importPKCS8(env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256');
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/identitytoolkit' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(env.FIREBASE_CLIENT_EMAIL)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt(now).setExpirationTime(now + 300).sign(key);
    const response = await transport('https://oauth2.googleapis.com/token', {
      method: 'POST', redirect: 'manual', signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const body: unknown = await response.json();
    if (!response.ok || !body || typeof body !== 'object' || !('access_token' in body) || typeof body.access_token !== 'string' || !body.access_token) throw new Error('INVALID_TOKEN');
    return body.access_token;
  } catch {
    throw new HttpError(503, 'PROVIDER_UNAVAILABLE', 'Não foi possível concluir a solicitação agora. Tente novamente.');
  }
}
