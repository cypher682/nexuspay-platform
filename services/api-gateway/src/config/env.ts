import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "debug"]).default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  JWT_SECRET: z.string().min(32),
  AUTH_ISSUER: z.string().default("NexusPay"),

  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(20),

  INTERNAL_API_KEY: z.string().min(16),
  AUTH_SERVICE_URL: z.string().url().default("http://localhost:4001"),
  PAYMENTS_SERVICE_URL: z.string().url().default("http://localhost:4002"),
  NOTIFICATIONS_SERVICE_URL: z.string().url().default("http://localhost:4003"),
  DOWNSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  CIRCUIT_BREAKER_OPEN_SECONDS: z.coerce.number().int().positive().default(15)
});

export const env =
  process.env.NODE_ENV === "test"
    ? envSchema.parse({
        ...process.env,
        JWT_SECRET: process.env.JWT_SECRET ?? "test-secret-value-at-least-32-chars",
        INTERNAL_API_KEY: process.env.INTERNAL_API_KEY ?? "test-internal-api-key-value"
      })
    : envSchema.parse(process.env);
