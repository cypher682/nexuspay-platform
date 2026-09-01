import "dotenv/config";
import { z } from "zod";

const boolFromEnv = z.preprocess(
  (v) => (v === undefined || v === "" ? true : !["false", "0", "no", "off"].includes(String(v).toLowerCase())),
  z.boolean()
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4003),
  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "debug"]).default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default(
      "postgresql://nexuspay:nexuspay@localhost:5433/nexuspay_notifications?schema=public"
    ),
  RABBITMQ_URL: z.string().min(1).default("amqp://nexuspay:nexuspay@localhost:5672"),
  QUEUE_NAME: z.string().min(1).default("nexuspay.notifications.send"),

  OTEL_TRACES_ENABLED: boolFromEnv,
  OTEL_TRACES_ENDPOINT: z.string().url().default("http://localhost:4318/v1/traces"),
  METRICS_ENABLED: boolFromEnv,

  INTERNAL_API_KEY: z.string().min(16),

  SMTP_URL: z.string().min(1).default("smtp://localhost:1025"),
  SMTP_FROM: z.string().default("NexusPay <no-reply@nexuspay.local>"),
  SMS_PROVIDER: z.enum(["mock"]).default("mock")
});

export const env =
  process.env.NODE_ENV === "test"
    ? envSchema.parse({
        ...process.env,
        INTERNAL_API_KEY:
          process.env.INTERNAL_API_KEY ?? "test-internal-api-key-1234567890"
      })
    : envSchema.parse(process.env);
