import Redis from "ioredis";
import { env } from "../config/env";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false
});

redis.on("error", (err) => {
  if (process.env.NODE_ENV !== "test") {
    console.error("Redis error (api-gateway):", err.message);
  }
});

export async function closeRedis(): Promise<void> {
  await redis.quit();
}
