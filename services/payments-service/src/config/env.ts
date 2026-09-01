import "dotenv/config";
import { z } from "zod";

const boolFromEnv = z.preprocess(
  (v) => (v === undefined || v === "" ? true : !["false", "0", "no", "off"].includes(String(v).toLowerCase())),
  z.boolean()
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4002),
  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "debug"]).default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://nexuspay:nexuspay@localhost:5433/nexuspay_payments?schema=public"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  RABBITMQ_URL: z.string().min(1).default("amqp://nexuspay:nexuspay@localhost:5672"),
  EVENTS_EXCHANGE: z.string().min(1).default("nexuspay.events"),

  OTEL_TRACES_ENABLED: boolFromEnv,
  OTEL_TRACES_ENDPOINT: z.string().url().default("http://localhost:4318/v1/traces"),
  METRICS_ENABLED: boolFromEnv,

  JWT_SECRET: z.string().min(32),
  AUTH_ISSUER: z.string().default("NexusPay"),
  PAYMENT_PROCESSING_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  PROVIDER_WEBHOOK_SECRET: z.string().min(16),
  RECONCILIATION_TOLERANCE_MINOR: z.coerce.number().int().min(0).default(0)
});

export const env =
  process.env.NODE_ENV === "test"
    ? envSchema.parse({
        ...process.env,
        JWT_SECRET: process.env.JWT_SECRET ?? "test-secret-value-at-least-32-chars",
        PROVIDER_WEBHOOK_SECRET: process.env.PROVIDER_WEBHOOK_SECRET ?? "test-webhook-secret-value"
      })
    : envSchema.parse(process.env);
