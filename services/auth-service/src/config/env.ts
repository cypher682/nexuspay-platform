import "dotenv/config";
import { z } from "zod";

const boolFromEnv = z.preprocess(
  (v) => (v === undefined || v === "" ? true : !["false", "0", "no", "off"].includes(String(v).toLowerCase())),
  z.boolean()
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4001),
  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "debug"]).default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://nexuspay:nexuspay@localhost:5433/nexuspay_auth?schema=public"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  RABBITMQ_URL: z.string().min(1).default("amqp://nexuspay:nexuspay@localhost:5672"),
  EVENTS_EXCHANGE: z.string().min(1).default("nexuspay.events"),
  PUBLIC_BASE_URL: z.string().min(1).default("http://localhost:4000"),

  OTEL_TRACES_ENABLED: boolFromEnv,
  OTEL_TRACES_ENDPOINT: z.string().url().default("http://localhost:4318/v1/traces"),
  METRICS_ENABLED: boolFromEnv,

  JWT_SECRET: z.string().min(32),
  JWT_ALGORITHM: z.enum(["HS256", "HS512"]).default("HS256"),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  MFA_CHALLENGE_TTL_MINUTES: z.coerce.number().int().positive().default(5),
  MFA_ISSUER: z.string().default("NexusPay"),

  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  VERIFICATION_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(24),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60)
});

export const env =
  process.env.NODE_ENV === "test"
    ? envSchema.parse({ ...process.env, JWT_SECRET: process.env.JWT_SECRET ?? "test-secret-value-at-least-32-chars" })
    : envSchema.parse(process.env);
