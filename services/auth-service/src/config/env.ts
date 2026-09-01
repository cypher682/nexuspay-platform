import "dotenv/config";
import { z } from "zod";

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

  JWT_SECRET: z.string().min(32),
  JWT_ALGORITHM: z.enum(["HS256", "HS512"]).default("HS256"),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  MFA_CHALLENGE_TTL_MINUTES: z.coerce.number().int().positive().default(5),
  MFA_ISSUER: z.string().default("NexusPay"),

  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_TTL_SECONDS: z.coerce.number().int().positive().default(900)
});

export const env =
  process.env.NODE_ENV === "test"
    ? envSchema.parse({ ...process.env, JWT_SECRET: process.env.JWT_SECRET ?? "test-secret-value-at-least-32-chars" })
    : envSchema.parse(process.env);
