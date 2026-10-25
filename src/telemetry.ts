import type { WorkerEnv } from './types.ts';

type LogEnv = Pick<WorkerEnv, 'APP_ENV' | 'OTEL_EXPORTER_OTLP_ENDPOINT' | 'OTEL_EXPORTER_OTLP_HEADERS'>;

export function requestLog(request: Request, status: number, durationMs: number, requestId: string, environment: string, now = Date.now()): object {
  const pathname = new URL(request.url).pathname;
  const route = ['/auth/forgot-password', '/auth/reset-password'].includes(pathname) ? pathname : 'unmatched';
  const method = ['GET', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(request.method) ? request.method : 'OTHER';
  const severity = status >= 500 ? { number: 17, text: 'ERROR' } : status >= 400 ? { number: 13, text: 'WARN' } : { number: 9, text: 'INFO' };
  return {
    resourceLogs: [{
      resource: { attributes: [
        { key: 'service.name', value: { stringValue: 'astro-password-reset' } },
        { key: 'deployment.environment.name', value: { stringValue: ['production', 'development'].includes(environment) ? environment : 'unknown' } },
      ] },
      scopeLogs: [{ scope: { name: 'astro.password-reset.http', version: '1.0.0' }, logRecords: [{
        timeUnixNano: (BigInt(now) * 1000000n).toString(),
        severityNumber: severity.number,
        severityText: severity.text,
        body: { stringValue: 'password_reset.request_completed' },
        attributes: [
          { key: 'http.route', value: { stringValue: route } },
          { key: 'http.request.method', value: { stringValue: method } },
          { key: 'http.response.status_code', value: { intValue: status } },
          { key: 'http.server.request.duration_ms', value: { doubleValue: Math.max(0, Math.round(durationMs)) } },
          { key: 'request.id', value: { stringValue: requestId } },
        ],
      }] }],
    }],
  };
}

/** Allowlist de metadados: nunca recebe corpo, headers, erro bruto, e-mail ou código. */
export async function exportRequestLog(request: Request, status: number, durationMs: number, requestId: string, env: LogEnv, transport: typeof fetch = fetch): Promise<boolean> {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT || !env.OTEL_EXPORTER_OTLP_HEADERS) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const endpoint = new URL(env.OTEL_EXPORTER_OTLP_ENDPOINT);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return false;
    const parts = env.OTEL_EXPORTER_OTLP_HEADERS.split(',');
    const authorization = parts.find(part => part.trim().startsWith('Authorization='));
    if (!authorization) return false;
    const value = decodeURIComponent(authorization.trim().slice('Authorization='.length));
    if (!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
    endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') + '/v1/logs';
    const response = await transport(endpoint.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: value },
      body: JSON.stringify(requestLog(request, status, durationMs, requestId, env.APP_ENV)),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) { await response.body?.cancel(); return false; }
    if (response.status === 204) return true;
    // OTLP pode aceitar HTTP 200 e ainda rejeitar registros parcialmente.
    const body: unknown = await response.json();
    const partial = body && typeof body === 'object' && 'partialSuccess' in body ? body.partialSuccess : undefined;
    return !(partial && typeof partial === 'object' && 'rejectedLogRecords' in partial && Number(partial.rejectedLogRecords) > 0);
  } catch { return false; }
  finally { clearTimeout(timer); }
}
