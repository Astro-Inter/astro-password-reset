import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { sendRecoveryEmail, buildResetUrl } from '../src/recovery-email.ts';
import { passwordResetTemplate } from '../src/templates/password-reset.ts';
import { handleRequest, recoveryMessage } from '../src/app.ts';
import type { WorkerEnv } from '../src/types.ts';

const keys = await generateKeyPair('RS256', { extractable: true });
const privateKey = await exportPKCS8(keys.privateKey);
function environment(): WorkerEnv {
  return { FIREBASE_API_KEY: 'test-web-key', FIREBASE_PROJECT_ID: 'test-project', FIREBASE_CLIENT_EMAIL: 'sender@test-project.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: privateKey, SENDGRID_API_KEY: 'fake-sendgrid-key', SENDGRID_SENDER_EMAIL: 'sender@example.test', EMAIL_DELIVERY_MODE: 'sendgrid', FRONTEND_BASE_URL: 'https://astro-inter.github.io/astro-web', ALLOWED_ORIGINS: 'https://astro-inter.github.io', APP_ENV: 'production', PASSWORD_RATE_LIMITER: { limit: async () => ({ success: true }) } };
}
function request(): Request {
  return new Request('https://worker.test/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' }, body: '{"email":"user@example.test"}' });
}
function providers(options: { firebaseCode?: string; mailStatus?: number; malformedLink?: boolean } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    if (String(url) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'fake-oauth-token' });
    if (String(url).includes('identitytoolkit.googleapis.com')) {
      if (options.firebaseCode) return Response.json({ error: { message: options.firebaseCode } }, { status: 400 });
      return Response.json({ oobLink: options.malformedLink ? 'not-a-link' : 'https://test-project.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=fake-code&apiKey=ignored' });
    }
    if (String(url) === 'https://api.sendgrid.com/v3/mail/send') return new Response(null, { status: options.mailStatus ?? 202 });
    throw new Error('unexpected outbound request');
  };
  return { calls, transport };
}

test('OAuth assinado, geração Firebase e entrega HTML/texto via SendGrid', async () => {
  const env = environment();
  // PEM com quebras escapadas, como em variável local.
  env.FIREBASE_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');
  const { calls, transport } = providers();
  const response = await handleRequest(request(), env, transport);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, message: recoveryMessage });
  assert.equal(calls.length, 3);
  const assertion = new URLSearchParams(String(calls[0]!.init.body)).get('assertion')!;
  const verified = await jwtVerify(assertion, keys.publicKey, { issuer: env.FIREBASE_CLIENT_EMAIL, audience: 'https://oauth2.googleapis.com/token', algorithms: ['RS256'] });
  assert.equal(verified.payload.scope, 'https://www.googleapis.com/auth/identitytoolkit');
  assert.equal(verified.payload.exp! - verified.payload.iat!, 300);
  assert.deepEqual(JSON.parse(String(calls[1]!.init.body)), { requestType: 'PASSWORD_RESET', email: 'user@example.test', targetProjectId: 'test-project', returnOobLink: true });
  assert.equal(new Headers(calls[1]!.init.headers).get('Authorization'), 'Bearer fake-oauth-token');
  const mail = JSON.parse(String(calls[2]!.init.body));
  assert.equal(mail.from.name, 'Astro');
  assert.equal(mail.from.email, 'sender@example.test');
  assert.deepEqual(mail.personalizations, [{ to: [{ email: 'user@example.test' }] }]);
  assert.equal(mail.content[0].type, 'text/plain');
  assert.equal(mail.content[1].type, 'text/html');
  assert.match(mail.content[1].value, /mode=resetPassword&amp;oobCode=fake-code/);
  assert.match(mail.content[0].value, /https:\/\/astro-inter.github.io\/astro-web\/replacePassword\?mode=resetPassword&oobCode=fake-code/);
  assert.doesNotMatch(mail.content[1].value, /Ludos|24 horas|apiKey|ignored/);
  assert.equal(mail.attachments[0].content_id, 'logo-astro');
  assert.equal(mail.attachments[1].content_id, 'recovery-planet');
  assert.ok(Buffer.from(mail.attachments[0].content, 'base64').subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  assert.equal(mail.tracking_settings.click_tracking.enable, false);
  assert.equal(mail.tracking_settings.open_tracking.enable, false);
  assert.equal(calls[2]!.init.redirect, 'error');
});

for (const firebaseCode of ['EMAIL_NOT_FOUND', 'USER_DISABLED']) test(`conta indisponível mantém resposta genérica: ${firebaseCode}`, async () => {
  const { calls, transport } = providers({ firebaseCode });
  const response = await handleRequest(request(), environment(), transport);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, message: recoveryMessage });
  assert.equal(calls.length, 2);
});

for (const options of [{ mailStatus: 401 }, { mailStatus: 429 }, { mailStatus: 500 }, { firebaseCode: 'PERMISSION_DENIED' }, { malformedLink: true }]) test(`falha operacional não simula envio: ${JSON.stringify(options)}`, async () => {
  const { transport } = providers(options);
  const response = await handleRequest(request(), environment(), transport);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /fake-code|fake-oauth|fake-sendgrid|PRIVATE KEY|user@example/);
});

test('credenciais ausentes, PEM inválido e token rejeitado são erros seguros', async () => {
  const { transport } = providers();
  for (const env of [{ ...environment(), SENDGRID_API_KEY: '' }, { ...environment(), FIREBASE_PRIVATE_KEY: 'invalid' }]) {
    await assert.rejects(sendRecoveryEmail('user@example.test', env, transport), { code: 'PROVIDER_UNAVAILABLE' });
  }
  await assert.rejects(sendRecoveryEmail('user@example.test', environment(), async () => Response.json({ error: 'invalid_grant' }, { status: 400 })), { code: 'PROVIDER_UNAVAILABLE' });
});

test('link usa rota fixa e codifica o código; template escapa atributos HTML', () => {
  const link = buildResetUrl('https://astro-inter.github.io/astro-web/', 'fake&code="');
  assert.equal(new URL(link).pathname, '/astro-web/replacePassword');
  assert.equal(new URL(link).searchParams.get('oobCode'), 'fake&code="');
  const content = passwordResetTemplate('https://example.test/reset?x="<tag>&other=1');
  assert.doesNotMatch(content.html, /x="<tag>/);
  assert.match(content.html, /&quot;&lt;tag&gt;&amp;/);
  assert.match(content.text, /x="<tag>/);
  assert.throws(() => buildResetUrl('https://example.test', ''));
  assert.throws(() => passwordResetTemplate('javascript:alert(1)'));
});

test('orçamento total de oito segundos cancela a entrega sem vazar erro', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const pending = sendRecoveryEmail('user@example.test', environment(), async (_url, init) => new Promise((_resolve, reject) => {
    started(); init!.signal!.addEventListener('abort', () => reject(new Error('private-error')));
  }));
  await ready;
  const rejected = assert.rejects(pending, { code: 'PROVIDER_UNAVAILABLE' });
  context.mock.timers.tick(8000);
  await rejected;
});
