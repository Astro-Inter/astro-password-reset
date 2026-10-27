import { observe } from "./diagnostics.ts";
import { sendSmtp, type SmtpDeliver } from './smtp.ts';
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
export async function sendRecoveryEmail(email: string, env: WorkerEnv, transport: FirebaseFetch = fetch, deliver: SmtpDeliver = sendSmtp): Promise<void> {
  const controller = new AbortController();
  // Inclui OAuth, geração do link e aceitação SMTP da mensagem completa.
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    if (!env.FIREBASE_PROJECT_ID || !env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM_EMAIL) throw unavailable();
    const sender = recoveryEmail({ email: env.SMTP_FROM_EMAIL });
    const accessToken = await observe("oauth_token", "google_oauth", () => googleAccessToken(env, transport, controller.signal));
    const generated = await transport(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Firebase-Locale': 'pt-BR' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email, targetProjectId: env.FIREBASE_PROJECT_ID, returnOobLink: true }),
    });
    const body: unknown = await generated.json();
    if (!generated.ok) {
      const error = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
      const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message.split(/[ :]/)[0] : '';
      if (generated.status === 400 && ['EMAIL_NOT_FOUND', 'USER_DISABLED'].includes(message ?? '')) return;
      throw Object.assign(unavailable(), {
        cause: Object.assign(new Error('Firebase link request rejected'), { code: `FIREBASE_HTTP_${generated.status}` }),
      });
    }
    // Firebase com proteção contra enumeração responde 200 sem link para conta ausente.
    if (body && typeof body === 'object' && !('oobLink' in body) &&
      'kind' in body && body.kind === 'identitytoolkit#GetOobConfirmationCodeResponse' &&
      'email' in body && body.email === email) return;
    if (!body || typeof body !== 'object' || !('oobLink' in body) || typeof body.oobLink !== 'string') throw unavailable();
    const generatedLink = new URL(body.oobLink);
    const codes = generatedLink.searchParams.getAll('oobCode');
    if (generatedLink.protocol !== 'https:' || codes.length !== 1) throw unavailable();
    const link = buildResetUrl(env.FRONTEND_BASE_URL, codes[0]!);
    const content = passwordResetTemplate(link);
    await observe("smtp_delivery", "smtp", () => deliver({ from: sender, to: email, subject: 'Redefinição de senha — Astro', text: content.text, html: content.html,
      attachments: [
        { content: astroLogoBase64, filename: 'logo-astro.png', cid: 'logo-astro' },
        { content: recoveryPlanetBase64, filename: 'recovery-planet.png', cid: 'recovery-planet' },
      ],
    }, env, controller.signal));
  } catch (error) { throw Object.assign(unavailable(), { cause: error }); }
  finally { clearTimeout(timeout); }
}
