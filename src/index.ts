import { diagnostic } from "./diagnostics.ts";
import { handleRequest } from './app.ts';
import type { WorkerEnv } from './types.ts';
import { exportRequestLog } from './telemetry.ts';

export default {
  async fetch(request: Request, env: WorkerEnv, context: ExecutionContext): Promise<Response> {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    let failure = {};
    const response = await handleRequest(request, env, undefined, undefined, error => { failure = diagnostic(error); });
    response.headers.set('X-Request-ID', requestId);
    context.waitUntil(exportRequestLog(request, response.status, Date.now() - started, requestId, env, undefined, failure));
    return response;
  },
};
