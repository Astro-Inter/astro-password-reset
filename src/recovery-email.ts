import { googleAccessToken } from './google-auth.ts';
import { HttpError } from './http.ts';
import { recoveryEmail } from './validation.ts';
import { passwordResetTemplate } from './templates/password-reset.ts';
import { astroLogoBase64 } from './templates/astro-logo.ts';
import { recoveryPlanetBase64 } from './templates/design-assets.ts';
import type { FirebaseFetch, WorkerEnv } from './types.ts';

const unavailable = () => new HttpError(503, 'PROVIDER_UNAVAILABLE', 'Não foi possível concluir a solicitação agora. Tente novamente.');

export function buildResetUrl(frontendBase: string, code: string): string {
  if (!code || code.length > 2048 || /\s/.test(code)) throw unavailable();
  const url = new URL(frontendBase.replace(/\/+$/, '') + '/replacePassword');
  url.search = '';
  url.hash = '';
  url.searchParams.set('mode', 'resetPassword');
  url.searchParams.set('oobCode', code);
  return url.toString();
}

/** Gera o código no Firebase e entrega HTML próprio, como o fluxo Ludos. */
export async function sendRecoveryEmail(email: string, env: WorkerEnv, transport: FirebaseFetch = fetch): Promise<void> {
  const controller = new AbortController();
  // Orçamento total das três chamadas: OAuth, geração e entrega.
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    if (!env.FIREBASE_PROJECT_ID || !env.SENDGRID_API_KEY?.trim() || !env.SENDGRID_SENDER_EMAIL) throw unavailable();
    const sender = recoveryEmail({ email: env.SENDGRID_SENDER_EMAIL });
    const accessToken = await googleAccessToken(env, transport, controller.signal);
    const generated = await transport(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Firebase-Locale': 'pt-BR' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email, targetProjectId: env.FIREBASE_PROJECT_ID, returnOobLink: true }),
    });
    const body: unknown = await generated.json();
    if (!generated.ok) {
      const error = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
      const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message.split(/[ :]/)[0] : '';
      if (generated.status === 400 && ['EMAIL_NOT_FOUND', 'USER_DISABLED'].includes(message ?? '')) return;
      throw unavailable();
    }
    if (!body || typeof body !== 'object' || !('oobLink' in body) || typeof body.oobLink !== 'string') throw unavailable();
    const generatedLink = new URL(body.oobLink);
    const codes = generatedLink.searchParams.getAll('oobCode');
    if (generatedLink.protocol !== 'https:' || codes.length !== 1) throw unavailable();
    const link = buildResetUrl(env.FRONTEND_BASE_URL, codes[0]!);
    const content = passwordResetTemplate(link);
    const delivered = await transport('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: sender, name: 'Astro' }, subject: 'Redefinição de senha — Astro',
        content: [{ type: 'text/plain', value: content.text }, { type: 'text/html', value: content.html }],
        attachments: [
          { content: astroLogoBase64, type: 'image/png', filename: 'logo-astro.png', disposition: 'inline', content_id: 'logo-astro' },
          { content: recoveryPlanetBase64, type: 'image/png', filename: 'recovery-planet.png', disposition: 'inline', content_id: 'recovery-planet' },
        ],
        tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false }, subscription_tracking: { enable: false }, ganalytics: { enable: false } },
      }),
    });
    await delivered.body?.cancel();
    if (delivered.status !== 202) throw unavailable();
  } catch { throw unavailable(); }
  finally { clearTimeout(timeout); }
}
