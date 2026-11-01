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
  PORT: z.coerce.number().int().positive().default(4006),
  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "debug"]).default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://nexuspay:nexuspay@localhost:5433/nexuspay_reporting?schema=public"),
  PAYMENTS_DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://nexuspay:nexuspay@localhost:5433/nexuspay_payments?schema=public"),

  JWT_SECRET: z.string().min(32),
  OLD_JWT_SECRETS: z.string().default(""),
  JWT_ALGORITHM: z.enum(["HS256", "HS384", "HS512"]).default("HS256"),

  INTERNAL_API_KEY: z.string().min(16),
  SNAPSHOT_DAYS: z.coerce.number().int().min(1).max(90).default(7),

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
