export interface WorkerEnv {
  FIREBASE_API_KEY: string;
  FRONTEND_BASE_URL: string;
  ALLOWED_ORIGINS: string;
  APP_ENV: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_EXPORTER_OTLP_HEADERS?: string;
  PASSWORD_RATE_LIMITER: Pick<RateLimit, 'limit'>;
}

export type FirebaseFetch = typeof fetch;
