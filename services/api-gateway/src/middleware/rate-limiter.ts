import type { NextFunction, Request, RequestHandler, Response } from "express";
import { env } from "../config/env";
import { redis } from "../lib/redis";

interface RateLimiterOptions {
  windowSeconds?: number;
  maxRequests?: number;
  bucketSuffix?: string;
}

export function slidingWindowRateLimiter(
  options: RateLimiterOptions = {}
): RequestHandler {
  const {
    windowSeconds = env.RATE_LIMIT_WINDOW_SECONDS,
    maxRequests = env.RATE_LIMIT_MAX_REQUESTS,
    bucketSuffix = "general"
  } = options;

  return async function rateLimiter(req, res, next) {
    const identity =
      req.auth?.userId ??
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() ??
      req.ip ??
      "anonymous";
    const key = `ratelimit:${bucketSuffix}:${identity}`;
    const now = Date.now();
    const member = `${now}:${Math.random().toString(36).slice(2)}`;

    try {
      const pipeline = redis.multi();
      pipeline.zremrangebyscore(key, 0, now - windowSeconds * 1000);
      pipeline.zadd(key, String(now), member);
      pipeline.zcard(key);
      pipeline.pexpire(key, windowSeconds * 1000);
      const results = await pipeline.exec();
      const count = Number(results?.[2]?.[1] ?? 0);

      res.setHeader("RateLimit-Limit", String(maxRequests));
      res.setHeader(
        "RateLimit-Remaining",
        String(Math.max(0, maxRequests - count))
      );

      if (count > maxRequests) {
        const retryAfter = Math.ceil(windowSeconds / 2);
        res.setHeader("Retry-After", String(retryAfter));
        res.status(429).json({
          error: "request_failed",
          message: "Too many requests",
          requestId: req.requestId
        });
        return;
      }

      next();
    } catch {
      next();
    }
  };
}
