import Redis from "ioredis";
import { env } from "../config/env";
import { logger } from "./logger";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  lazyConnect: false
});

redis.on("error", (err) => {
  logger.warn("redis.error", { error: err instanceof Error ? err.message : String(err) });
});

export async function incrementVelocity(userId: string, windowSeconds: number): Promise<number> {
  const key = `fraud:velocity:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count - 1;
}
