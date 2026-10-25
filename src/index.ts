import { handleRequest } from './app.ts';
import type { WorkerEnv } from './types.ts';

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> { return handleRequest(request, env); },
};
