import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, recoveryMessage } from '../src/app.ts';
import type { WorkerEnv } from '../src/types.ts';

function environment(): WorkerEnv {
  return { FIREBASE_API_KEY: 'test-key', FRONTEND_BASE_URL: 'https://astro-inter.github.io/astro-web', ALLOWED_ORIGINS: 'https://astro-inter.github.io', APP_ENV: 'production', PASSWORD_RATE_LIMITER: { limit: async () => ({ success: true }) } };
}
function request(path = 'forgot-password', body: unknown = { email: 'user@example.com' }, init: RequestInit = {}): Request {
  return new Request(`https://worker.test/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://astro-inter.github.io', 'CF-Connecting-IP': '192.0.2.1' }, body: JSON.stringify(body), ...init });
}
const ok = async () => Response.json({ email: 'private@example.com' });
const failure = (message: string, status = 400) => async () => Response.json({ error: { message } }, { status });
const validReset = { oobCode: 'private-code', newPassword: 'SenhaForte123!' };

test('solicitação normaliza espaços e envia contrato Firebase localizado', async () => {
  const transport = mock.fn(ok);
  const response = await handleRequest(request('forgot-password', { email: ' user@example.com ' }), environment(), transport);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, message: recoveryMessage });
  const [url, options] = transport.mock.calls[0].arguments as unknown as [string, RequestInit];
  assert.equal(url, 'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=test-key');
  assert.deepEqual(JSON.parse(options.body as string), { requestType: 'PASSWORD_RESET', email: 'user@example.com' });
  assert.equal((options.headers as Record<string, string>)['X-Firebase-Locale'], 'pt-BR');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

for (const code of ['EMAIL_NOT_FOUND', 'USER_DISABLED']) test(`${code} não revela existência da conta`, async () => {
  const found = await handleRequest(request(), environment(), ok);
  const absent = await handleRequest(request(), environment(), failure(code));
  assert.equal(absent.status, 200);
  assert.equal(await found.text(), await absent.text());
});

for (const email of ['', 'invalid', null, 12, 'a'.repeat(65) + '@example.com', 'a@' + 'b'.repeat(250) + '.com', 'user\n@example.com']) test(`e-mail inválido ${JSON.stringify(email)}`, async () => {
  const transport = mock.fn(ok);
  const response = await handleRequest(request('forgot-password', { email }), environment(), transport);
  assert.equal(response.status, 400);
  assert.equal(transport.mock.callCount(), 0);
});

test('confirmação envia somente código e senha, sem escolher conta pelo e-mail', async () => {
  const transport = mock.fn(ok);
  const response = await handleRequest(request('reset-password', { ...validReset, email: 'attacker@example.com' }), environment(), transport);
  assert.equal(response.status, 200);
  const [, options] = transport.mock.calls[0].arguments as unknown as [string, RequestInit];
  assert.deepEqual(JSON.parse(options.body as string), validReset);
  assert.doesNotMatch(await response.text(), /private|SenhaForte|test-key/);
});
for (const code of ['INVALID_OOB_CODE', 'EXPIRED_OOB_CODE', 'USER_DISABLED', 'EMAIL_NOT_FOUND']) test(`código inválido, expirado ou usado: ${code}`, async () => {
  const response = await handleRequest(request('reset-password', validReset), environment(), failure(code));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_OR_EXPIRED_CODE');
});
for (const code of ['WEAK_PASSWORD : details', 'PASSWORD_DOES_NOT_MEET_REQUIREMENTS']) test(`senha rejeitada: ${code}`, async () => {
  const response = await handleRequest(request('reset-password', validReset), environment(), failure(code));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_PASSWORD');
});
for (const body of [{}, { oobCode: '' }, { oobCode: 12, newPassword: 'valid-password' }, { ...validReset, newPassword: '123' }, { ...validReset, oobCode: 'a'.repeat(2049) }]) test(`payload de confirmação inválido ${JSON.stringify(body).slice(0, 60)}`, async () => {
  const transport = mock.fn(ok);
  assert.equal((await handleRequest(request('reset-password', body), environment(), transport)).status, 400);
  assert.equal(transport.mock.callCount(), 0);
});
for (const body of ['{', 'null', '[]', '"string"']) test(`JSON inválido ${body}`, async () => {
  assert.equal((await handleRequest(request('forgot-password', {}, { body }), environment(), ok)).status, 400);
});
test('limite de 8 KiB funciona sem Content-Length e com multibyte', async () => {
  assert.equal((await handleRequest(request('forgot-password', { email: 'é'.repeat(4500) }), environment(), ok)).status, 413);
});
test('limite declarado e Content-Type', async () => {
  assert.equal((await handleRequest(request('forgot-password', {}, { headers: { 'Content-Type': 'application/json', 'Content-Length': '9000', 'CF-Connecting-IP': '192.0.2.1' } }), environment(), ok)).status, 413);
  assert.equal((await handleRequest(request('forgot-password', {}, { headers: { 'Content-Type': 'text/plain', 'CF-Connecting-IP': '192.0.2.1' } }), environment(), ok)).status, 415);
});
test('preflight permite somente origem, método e cabeçalho previstos', async () => {
  const preflight = (origin: string, method = 'POST', header = 'content-type') => new Request('https://worker.test/auth/reset-password', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': header } });
  const response = await handleRequest(preflight('https://astro-inter.github.io'), environment(), ok);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://astro-inter.github.io');
  const denied = await handleRequest(preflight('https://evil.test'), environment(), ok);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await handleRequest(preflight('https://astro-inter.github.io', 'PUT'), environment(), ok)).status, 405);
  assert.equal((await handleRequest(preflight('https://astro-inter.github.io', 'POST', 'authorization'), environment(), ok)).status, 403);
});
test('limite por IP compartilha chave entre os dois endpoints e falha de modo seguro', async () => {
  const keys: string[] = [];
  const env = environment();
  env.PASSWORD_RATE_LIMITER = { limit: async ({ key }) => { keys.push(key); return { success: keys.length === 1 }; } };
  assert.equal((await handleRequest(request(), env, ok)).status, 200);
  const denied = await handleRequest(request('reset-password', validReset), env, ok);
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get('Retry-After'), '60');
  assert.equal(keys[0], keys[1]);
  env.PASSWORD_RATE_LIMITER = { limit: async () => { throw new Error('internal'); } };
  assert.equal((await handleRequest(request(), env, ok)).status, 503);
});
for (const transport of [failure('INTERNAL_SECRET', 500), failure('TOO_MANY_ATTEMPTS_TRY_LATER'), async () => { throw new Error('private-code SenhaForte123! test-key'); }, async () => new Response('not-json'), async () => Response.json(null)]) test('falhas operacionais não simulam envio nem expõem dados internos', async () => {
  const response = await handleRequest(request(), environment(), transport);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /INTERNAL|private-code|SenhaForte|test-key/);
});
test('envio aceita sucesso sem e-mail quando privacidade está habilitada', async () => {
  assert.equal((await handleRequest(request(), environment(), async () => Response.json({}))).status, 200);
  assert.equal((await handleRequest(request('reset-password', validReset), environment(), async () => Response.json({}))).status, 503);
});
test('timeout cancela requisição externa e retorna erro seguro', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = handleRequest(request(), environment(), async (_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
  }));
  // Permite a leitura assíncrona do corpo antes de iniciar o timeout do provedor.
  await new Promise(resolve => setImmediate(resolve));
  context.mock.timers.tick(8000);
  assert.equal((await pending).status, 503);
});
test('rotas, métodos, HTTPS e configuração são restritos', async () => {
  assert.equal((await handleRequest(new Request('https://worker.test/health'), environment(), ok)).status, 404);
  assert.equal((await handleRequest(new Request('https://worker.test/auth/reset-password'), environment(), ok)).status, 405);
  assert.equal((await handleRequest(new Request('http://worker.test/auth/reset-password'), environment(), ok)).status, 400);
  assert.equal((await handleRequest(request(), { ...environment(), FIREBASE_API_KEY: '' }, ok)).status, 503);
  assert.equal((await handleRequest(request(), { ...environment(), ALLOWED_ORIGINS: '*' }, ok)).status, 503);
});
