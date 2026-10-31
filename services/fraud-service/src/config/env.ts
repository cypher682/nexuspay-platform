import "dotenv/config";
import { z } from "zod";

const boolFromEnv = z.preprocess(
  (v) =>
    v === undefined || v === ""
      ? true
      : !["false", "0", "no", "off"].includes(String(v).toLowerCase()),
  z.boolean()
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4005),
  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "debug"]).default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://nexuspay:nexuspay@localhost:5433/nexuspay_fraud?schema=public"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  JWT_SECRET: z.string().min(32),
  OLD_JWT_SECRETS: z.string().default(""),
  JWT_ALGORITHM: z.enum(["HS256", "HS384", "HS512"]).default("HS256"),
  MFA_ISSUER: z.string().default("NexusPay"),
  INTERNAL_API_KEY: z.string().min(16),

  FRAUD_BLOCK_SCORE: z.coerce.number().int().min(0).max(100).default(70),
  FRAUD_REVIEW_SCORE: z.coerce.number().int().min(0).max(100).default(40),

  OTEL_TRACES_ENABLED: boolFromEnv,
  OTEL_TRACES_ENDPOINT: z.string().url().default("http://localhost:4318/v1/traces"),
  METRICS_ENABLED: boolFromEnv
});

export const env =
  process.env.NODE_ENV === "test"
    ? envSchema.parse({
        ...process.env,
        JWT_SECRET: process.env.JWT_SECRET ?? "test-secret-value-at-least-32-chars",
        INTERNAL_API_KEY: process.env.INTERNAL_API_KEY ?? "test-internal-api-key-value"
      })
    : envSchema.parse(process.env);
