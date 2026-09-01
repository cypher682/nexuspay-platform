import Redis from "ioredis";
import { env } from "../config/env";
import { logger } from "./logger";

declare global {
  var __redis: Redis | undefined;
}

export const redis =
  global.__redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 200, 5000),
    lazyConnect: false
  });

if (process.env.NODE_ENV === "test") {
  global.__redis = redis;
}

redis.on("error", (err) => logger.error("Redis error", { message: err.message }));

export async function closeRedis(): Promise<void> {
  if (redis.status === "end") return;
  await redis.quit().catch(() => redis.disconnect());
}
