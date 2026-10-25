export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  const result = new Headers(headers);
  result.set('Content-Type', 'application/json; charset=utf-8');
  result.set('Cache-Control', 'no-store');
  result.set('Referrer-Policy', 'no-referrer');
  result.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(value), { status, headers: result });
}

export function errorResponse(error: unknown, headers?: HeadersInit): Response {
  const safe = error instanceof HttpError ? error : new HttpError(503, 'SERVICE_UNAVAILABLE', 'Serviço temporariamente indisponível. Tente novamente.');
  const result = new Headers(headers);
  if (safe.status === 429) result.set('Retry-After', '60');
  return json({ success: false, error: { code: safe.code, message: safe.message } }, safe.status, result);
}

export async function readPayload(request: Request): Promise<Record<string, unknown>> {
  const maxBytes = 8192;
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envie um corpo JSON.');
  }
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição excede o limite de 8 KiB.');
  }
  if (!request.body) throw new HttpError(400, 'INVALID_PAYLOAD', 'Informe um objeto JSON válido.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição excede o limite de 8 KiB.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); }
  catch { throw new HttpError(400, 'INVALID_JSON', 'Informe um objeto JSON válido.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_PAYLOAD', 'Informe um objeto JSON válido.');
  }
  return value as Record<string, unknown>;
}
