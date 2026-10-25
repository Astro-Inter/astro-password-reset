export interface WorkerEnv {
  FIREBASE_API_KEY: string;
  FRONTEND_BASE_URL: string;
  ALLOWED_ORIGINS: string;
  APP_ENV: string;
  EMAIL_DELIVERY_MODE?: 'native' | 'smtp';
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM_EMAIL?: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_EXPORTER_OTLP_HEADERS?: string;
  PASSWORD_RATE_LIMITER: Pick<RateLimit, 'limit'>;
}

export type FirebaseFetch = typeof fetch;
