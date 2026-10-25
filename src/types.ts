export interface WorkerEnv {
  FIREBASE_API_KEY: string;
  FRONTEND_BASE_URL: string;
  ALLOWED_ORIGINS: string;
  APP_ENV: string;
  EMAIL_DELIVERY_MODE?: 'native' | 'sendgrid';
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  SENDGRID_API_KEY?: string;
  SENDGRID_SENDER_EMAIL?: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_EXPORTER_OTLP_HEADERS?: string;
  PASSWORD_RATE_LIMITER: Pick<RateLimit, 'limit'>;
}

export type FirebaseFetch = typeof fetch;
