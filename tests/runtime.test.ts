import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';

test('Worker executa no workerd com CORS, JSON e binding nativo de rate limit', async () => {
  const script = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true, script,
    compatibilityDate: '2026-10-25',
    bindings: { FIREBASE_API_KEY: 'fake-test-key', FRONTEND_BASE_URL: 'http://localhost:5173', ALLOWED_ORIGINS: 'http://localhost:5173', APP_ENV: 'development' },
    ratelimits: { PASSWORD_RATE_LIMITER: { namespace_id: '625', simple: { limit: 5, period: 60 } } },
  }));
  try {
    const request = () => worker.dispatchFetch('http://localhost/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: '{"email":"invalid"}' });
    const first = await request();
    assert.equal(first.status, 400);
    assert.equal(first.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
    assert.equal((await first.json()).error.code, 'INVALID_EMAIL');
    for (let index = 0; index < 4; index++) await request();
    assert.equal((await request()).status, 429);
  } finally { await worker.dispose(); }
});
