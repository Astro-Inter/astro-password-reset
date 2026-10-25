import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { exportRequestLog, requestLog } from '../src/telemetry.ts';
import worker from '../src/index.ts';
import type { WorkerEnv } from '../src/types.ts';

const env = { APP_ENV: 'production', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.test/otlp', OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic%20dXNlcjpwYXNz' };
const request = new Request('https://api.test/auth/reset-password?oobCode=private-code', { method: 'POST', headers: { Authorization: 'private-header', 'CF-Connecting-IP': '192.0.2.1' }, body: '{"newPassword":"private-password","email":"private@example.com"}' });

test('OTLP envia log JSON com Basic decodificado e endpoint /v1/logs', async () => {
  const transport = mock.fn(async () => Response.json({}));
  assert.equal(await exportRequestLog(request, 400, 12.4, 'generated-id', env, transport), true);
  const [url, options] = transport.mock.calls[0].arguments as unknown as [string, RequestInit];
  assert.equal(url, 'https://collector.test/otlp/v1/logs');
  assert.equal((options.headers as Record<string, string>).Authorization, 'Basic dXNlcjpwYXNz');
  assert.equal(options.redirect, 'error');
  const body = JSON.parse(options.body as string);
  assert.equal(body.resourceLogs[0].resource.attributes[0].value.stringValue, 'astro-password-reset');
  const log = body.resourceLogs[0].scopeLogs[0].logRecords[0];
  assert.equal(log.severityText, 'WARN');
  assert.match(log.timeUnixNano, /^\d+$/);
  assert.doesNotMatch(options.body as string, /private|192\.0|oobCode|Authorization|dXNlcj/);
});

test('caminhos desconhecidos, métodos e ambientes não entram como texto livre', () => {
  const body = JSON.stringify(requestLog(new Request('https://host.test/private-secret?q=secret', { method: 'CUSTOM' }), 500, -1, 'generated-id', 'private-env', 1000));
  assert.doesNotMatch(body, /private|CUSTOM|secret|host\.test/);
  assert.match(body, /unmatched/);
  assert.match(body, /ERROR/);
  assert.match(body, /1000000000/);
});

test('Grafana aceita o registro com HTTP 204 sem corpo', async () => {
  assert.equal(await exportRequestLog(request, 200, 10, 'generated-id', env, async () => new Response(null, { status: 204 })), true);
});

test('ausência de secret ou configuração insegura não faz requisição externa', async () => {
  const transport = mock.fn(async () => Response.json({}));
  for (const invalid of [
    { ...env, OTEL_EXPORTER_OTLP_HEADERS: '' },
    { ...env, OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=%ZZ' },
    { ...env, OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic%20abc%0Aextra' },
    { ...env, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.test/otlp' },
    { ...env, OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.test/otlp?secret=yes' },
  ]) assert.equal(await exportRequestLog(request, 200, 10, 'generated-id', invalid, transport), false);
  assert.equal(transport.mock.callCount(), 0);
});

test('erros, indisponibilidade e rejeição parcial do coletor são contidos', async () => {
  for (const transport of [async () => { throw new Error('private-provider-error'); }, async () => new Response('denied', { status: 401 }), async () => Response.json({ partialSuccess: { rejectedLogRecords: '1', errorMessage: 'private' } })]) {
    assert.equal(await exportRequestLog(request, 200, 10, 'generated-id', env, transport), false);
  }
});

test('timeout de três segundos cancela exportação', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = exportRequestLog(request, 200, 10, 'generated-id', env, async (_url, options) => new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new Error('timeout')))));
  context.mock.timers.tick(3000);
  assert.equal(await pending, false);
});

test('handler mantém resposta e agenda log usando waitUntil', async () => {
  const promises: Promise<unknown>[] = [];
  const config: WorkerEnv = { ...env, OTEL_EXPORTER_OTLP_HEADERS: '', FIREBASE_API_KEY: 'fake-key', FRONTEND_BASE_URL: 'https://web.test', ALLOWED_ORIGINS: 'https://web.test', PASSWORD_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  const context = { waitUntil: (promise: Promise<unknown>) => promises.push(promise) } as unknown as ExecutionContext;
  const response = await worker.fetch(new Request('https://api.test/missing?private=yes'), config, context);
  assert.equal(response.status, 404);
  assert.match(response.headers.get('X-Request-ID')!, /^[0-9a-f-]{36}$/);
  assert.equal(promises.length, 1);
  await Promise.all(promises);
});
