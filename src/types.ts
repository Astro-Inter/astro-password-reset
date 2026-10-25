export interface WorkerEnv {
  FIREBASE_API_KEY: string;
  FRONTEND_BASE_URL: string;
  ALLOWED_ORIGINS: string;
  APP_ENV: string;
  PASSWORD_RATE_LIMITER: Pick<RateLimit, 'limit'>;
}

export type FirebaseFetch = typeof fetch;
